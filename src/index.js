const core = require('@actions/core');
const github = require('@actions/github');
const fsPromises = require('fs').promises;
const fs = require('fs');
const Zip = require('adm-zip');
const config = require('./config');
const slack = require('./slackClient');

async function downloadPreviousArtifact(octokit) {
  const allArtifacts = await octokit.paginate(
    'GET /repos/{owner}/{repo}/actions/artifacts',
    {
      owner: config.owner,
      repo: config.repo,
    },
  );
  const firewatchArtifacts = allArtifacts.filter(
    (x) => x.name === 'firewatch' && x.expired === false,
  );

  if (firewatchArtifacts.length > 0) {
    firewatchArtifacts.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );

    const artifact = await octokit.request(
      `GET ${firewatchArtifacts[0].archive_download_url}`,
    );

    await fsPromises.writeFile(config.firewatchZip, Buffer.from(artifact.data));

    const zip = new Zip(config.firewatchZip);
    zip.extractEntryTo(config.firewatchData, './', true, true);
  }
}

async function main() {
  const octokit = github.getOctokit(config.githubToken, {
    previews: ['squirrel-girl'], // adds reactions to issue results
  });

  try {
    await downloadPreviousArtifact(octokit, config.owner, config.repo);
  } catch (error) {
    core.setFailed(`Unable to download previous artifact: ${error}.`);
  }

  let previousMap = new Map();

  if (fs.existsSync(config.firewatchData)) {
    try {
      const previousMapData = JSON.parse(
        await fsPromises.readFile(config.firewatchData),
      );
      if (previousMapData.version !== config.artifactFormatVerson) {
        core.info('Previous artifact has a different version format.');
      } else {
        previousMap = new Map(previousMapData.data);
      }
    } catch (error) {
      core.setFailed(
        `Getting existing data from '${config.firewatchData}' failed with error ${error}.`,
      );
    }
    core.info('Firewatch data loaded successfully.');
    core.info(`Existing map has ${previousMap.size} entries.`);
  } else {
    core.info('No previous file found.');
  }

  const dateThreshold = new Date();
  dateThreshold.setMonth(dateThreshold.getMonth() - config.issueAgeMonths);

  const currentMap = new Map();

  const issuesResult = await octokit.paginate('GET /search/issues', {
    q: `is:open repo:${config.owner}/${config.repo} created:>${
      dateThreshold.toISOString().split('T')[0]
    }`,
    per_page: 100,
  });

  issuesResult.forEach((issue) => {
    if (!currentMap.has(issue.number)) {
      currentMap.set(issue.number, {
        reactions: issue.reactions.total_count,
        title: issue.title,
        id: issue.number,
      });
    }
  });

  core.info(`Current map has ${currentMap.size} entries.`);

  try {
    await fsPromises.writeFile(
      config.firewatchData,
      JSON.stringify({
        version: config.artifactFormatVerson,
        data: Array.from(currentMap.entries()),
      }),
    );
    core.info('Firewatch data successfully written.');
  } catch (error) {
    core.setFailed(
      `Writing to ${config.firewatchData} failed with error ${error}.`,
    );
  }

  const alerts = [];

  if (previousMap.size > 0) {
    // eslint-disable-next-line no-restricted-syntax
    for (const [key, value] of currentMap.entries()) {
      if (previousMap.has(key)) {
        let diff = value.reactions - previousMap.get(key).reactions;
        if (diff < 0) diff *= -1;
        if (diff > config.alertThreshold) {
          alerts.push(value);
        }
      } else if (value.reactions > config.alertThreshold) {
        alerts.push(value);
      }
    }
  }

  core.info(`${alerts.length} alerts found.`);

  if (alerts.length > 0) {
    const alertBody = slack.formatAlerts(alerts);
    slack.sendAlerts(alertBody);
  }
}

try {
  main();
} catch (error) {
  core.setFailed(error.message);
}
