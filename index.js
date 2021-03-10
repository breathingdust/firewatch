const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const fsPromises = require('fs').promises;
const fs = require('fs');
const Zip = require('adm-zip');

const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const firewatchData = 'firewatch.data';
const artifactFormatVerson = '1.0';

async function downloadPreviousArtifact(octokit) {
  const firewatchZip = 'firewatch.zip';
  const allArtifacts = await octokit.paginate('GET /repos/{owner}/{repo}/actions/artifacts', {
    owner,
    repo,
  });
  const firewatchArtifacts = allArtifacts.filter((x) => x.name === 'firewatch');

  if (firewatchArtifacts.length > 0) {
    firewatchArtifacts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const artifact = await octokit.request(`GET ${firewatchArtifacts[0].archive_download_url}`);

    await fsPromises.writeFile(firewatchZip, Buffer.from(artifact.data));

    const zip = new Zip(firewatchZip);
    zip.extractEntryTo(firewatchData, './', true, true);
  }
}

async function main() {
  const githubToken = core.getInput('github_token');
  const alertThreshold = core.getInput('alert_threshold');
  const issueAgeMonths = core.getInput('issue_age_months');
  const slackToken = core.getInput('slack_token');
  const slackChannel = core.getInput('slack_channel');

  const octokit = github.getOctokit(githubToken, {
    previews: ['squirrel-girl'], // adds reactions to issue results
  });

  try {
    await downloadPreviousArtifact(octokit, owner, repo);
  } catch (error) {
    core.setFailed(`Unable to download previous artifact: ${error}.`);
  }

  let previousMap = new Map();

  if (fs.existsSync(firewatchData)) {
    try {
      const previousMapData = JSON.parse(await fsPromises.readFile(firewatchData));
      if (previousMapData.version !== artifactFormatVerson) {
        core.info('Previous artifact has a different version format.');
      } else {
        previousMap = new Map(previousMapData.data);
      }
    } catch (error) {
      core.setFailed(`Getting existing data from '${firewatchData}' failed with error ${error}.`);
    }
    core.info('Firewatch data loaded successfully');
    core.info(`Existing map has ${previousMap.size} entries.`);
  } else {
    core.info('No previous file found.');
  }

  const dateThreshold = new Date();
  dateThreshold.setMonth(dateThreshold.getMonth() - issueAgeMonths);

  const currentMap = new Map();

  const issuesResult = await octokit
    .paginate('GET /search/issues', {
      q: `is:open repo:${owner}/${repo} created:>${dateThreshold.toISOString().split('T')[0]}`,
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

  const alerts = [];

  if (previousMap.size > 0) {
    // eslint-disable-next-line no-restricted-syntax
    for (const [key, value] of currentMap.entries()) {
      if (previousMap.has(key)) {
        let diff = value.reactions - previousMap.get(key).reactions;
        if (diff < 0) diff *= -1;
        if (diff > alertThreshold) {
          alerts.push(value);
        }
      } else if (value.reactions > alertThreshold) {
        alerts.push(value);
      }
    }
  }

  core.info(`${alerts.length} alerts found.`);

  if (alerts.length > 0) {
    let alertLines = '';
    alerts.forEach((alert) => {
      alertLines += `${alert.title} <https://github.com/${owner}/${repo}/issues/${alert.id}>\n`;
    });

    const postMessageBody = {
      channel: slackChannel,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `The following issues have received more than ${alertThreshold} reactions in the configured time interval:`,
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: alertLines,
          },
        },
      ],
    };

    core.info(JSON.stringify(postMessageBody));

    axios({
      method: 'post',
      url: 'https://slack.com/api/chat.postMessage',
      headers: { Authorization: `Bearer ${slackToken}` },
      data: postMessageBody,
    })
      .then((res) => {
        core.info(`Slack Response: ${res.statusCode}`);
        core.info(res.data);
      })
      .catch((error) => {
        core.setFailed(`Posting to slack failed with error ${error}`);
      });

    try {
      await fsPromises.writeFile(firewatchData, JSON.stringify(
        {
          version: artifactFormatVerson,
          data: Array.from(currentMap.entries()),
        },
      ));
    } catch (error) {
      core.setFailed(`Writing to ${firewatchData} failed with error ${error}.`);
    }
  }
}

try {
  main();
} catch (error) {
  core.setFailed(error.message);
}
