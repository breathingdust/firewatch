const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const fsPromises = require('fs').promises;
const fs = require('fs');

async function main() {
  const githubToken = core.getInput('github_token');
  const org = core.getInput('org');
  const repo = core.getInput('repo');
  const alertThreshold = core.getInput('alert_threshold');
  const firewatchData = core.getInput('firewatch_data');
  const issue_age_months = core.getInput('issue_age_months');
  const slackToken = core.getInput('slack_token');
  const slackChannel = core.getInput('slack_channel');

  let previousMap = new Map();

  if (fs.existsSync(firewatchData)) {
    try {
      let previousMapData = await fsPromises.readFile(firewatchData);
      previousMap = new Map(JSON.parse(previousMapData));
    } catch (error) {
      core.setFailed(`Getting existing data from '${firewatchData}' failed with error ${error}`);
    }
    core.info('Firewatch data loaded successfully');
    core.info(`Existing map has ${previousMap.size} entries.`);
  }

  let d = new Date();
  d.setMonth(d.getMonth() - issue_age_months);

  const octokit = github.getOctokit(githubToken, {
    previews: ["squirrel-girl"]
  });

  let currentMap = new Map();

  let issuesResult = await octokit
    .paginate("GET /search/issues", {
      q: `is:open repo:${org}/${repo} created:>${d.toISOString().split('T')[0]
        }`,
      per_page: 100,
    });

  issuesResult.forEach(issue => {
    if (!currentMap.has(issue.number)) {
      currentMap.set(issue.number, issue.reactions.total_count)
    }
  });

  core.info(`Current map has ${currentMap.size} entries`);

  let alerts = [];

  if (previousMap.size > 0) {
    for (const [key, value] of currentMap.entries()) {
      if (previousMap.has(key)) {
        let diff = value - previousMap.get(key);
        console.log(diff);
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
    for (const [key, value] of currentMap.entries()) {
      alertLines += `<https://github.com/hashicorp/terraform-provider-aws/issues/${key}>\n`;
    }

    const postMessageBody = {
      channel: slackChannel,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Issues have recieved more than ${alertThreshold} in the configured interval:`,
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

    // axios({
    //   method: 'post',
    //   url: 'https://slack.com/api/chat.postMessage',
    //   headers: { Authorization: `Bearer ${slackToken}` },
    //   data: postMessageBody,
    // })
    //   .then((res) => {
    //     core.info(`Slack Response: ${res.statusCode}`);
    //     core.info(res.data);
    //   })
    //   .catch((error) => {
    //     core.setFailed(`Posting to slack failed with error ${error}`);
    //   });
    //}
  }
  try {
    await fsPromises.writeFile(firewatchData, JSON.stringify(Array.from(currentMap.entries())));
  } catch (error) {
    core.setFailed(`Writing to ${firewatchData} failed with error ${error}`);
  }
}

try {
  main();
} catch (error) {
  core.setFailed(error.message);
}
