const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const fsPromises = require('fs').promises;
const fs = require('fs');
var Zip = require("adm-zip");

const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
const firewatchData = 'firewatch.data';

async function main() {
  const githubToken = core.getInput('github_token');
  const alertThreshold = core.getInput('alert_threshold');
  const issue_age_months = core.getInput('issue_age_months');
  const slackToken = core.getInput('slack_token');
  const slackChannel = core.getInput('slack_channel');

  const octokit = github.getOctokit(githubToken, {
    previews: ["squirrel-girl"] // adds reactions to issue results
  });

  try {
    await downloadPreviousArtifact(octokit, owner, repo);
  } catch (error) {
    core.setFailed(`Unable to download previous artifact: ${error}.`);
  }

  let previousMap = new Map();

  if (fs.existsSync(firewatchData)) {
    try {
      let previousMapData = await fsPromises.readFile(firewatchData);
      previousMap = new Map(JSON.parse(previousMapData));
    } catch (error) {
      core.setFailed(`Getting existing data from '${firewatchData}' failed with error ${error}.`);
    }
    core.info('Firewatch data loaded successfully');
    core.info(`Existing map has ${previousMap.size} entries.`);
  } else {
    core.info('No previous file found.')
  }

  let d = new Date();
  d.setMonth(d.getMonth() - issue_age_months);

  let currentMap = new Map();

  let issuesResult = await octokit
    .paginate("GET /search/issues", {
      q: `is:open repo:${owner}/${repo} created:>${d.toISOString().split('T')[0]
        }`,
      per_page: 100,
    });

  issuesResult.forEach(issue => {
    if (!currentMap.has(issue.number)) {
      currentMap.set(issue.number, issue.reactions.total_count)
    }
  });

  core.info(`Current map has ${currentMap.size} entries.`);

  let alerts = [];

  if (previousMap.size > 0) {
    for (const [key, value] of currentMap.entries()) {
      if (previousMap.has(key)) {
        let diff = value - previousMap.get(key);
        if (diff < 0) diff *= -1;
        if (diff > alertThreshold) {
          alerts.push(key);
        }
      } else {
        if (value > alertThreshold) {
          alerts.push(key);
        }
      }
    }
  }

  core.info(`${alerts.length} alerts found.`);

  if (alerts.length > 0) {
    let alertLines = '';
    alerts.forEach(alert => {
      alertLines += `<https://github.com/${owner}/${repo}/issues/${alert}>\n`;
    });

    const postMessageBody = {
      channel: slackChannel,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `The following issues have recieved more than ${alertThreshold} in the configured interval:`,
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
    }
  }
  try {
    await fsPromises.writeFile(firewatchData, JSON.stringify(Array.from(currentMap.entries())));
  } catch (error) {
    core.setFailed(`Writing to ${firewatchData} failed with error ${error}.`);
  }
}

async function downloadPreviousArtifact(octokit, owner, repo) {
  const firewatchZip = 'firewatch.zip';
  let allArtifacts = await octokit.paginate('GET /repos/{owner}/{repo}/actions/artifacts', {
    owner: owner,
    repo: repo
  });
  let firewatchArtifacts = allArtifacts.filter(x => x.name == 'firewatch');

  if (firewatchArtifacts.length > 0) {

    firewatchArtifacts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    let artifact = await octokit.request(`GET ${firewatchArtifacts[0].archive_download_url}`);

    await fsPromises.writeFile(firewatchZip, Buffer.from(artifact.data));

    var zip = new Zip(firewatchZip); 
    zip.extractEntryTo(firewatchData, "./", true, true);
  }
}

try {
  main();
} catch (error) {
  core.setFailed(error.message);
}
