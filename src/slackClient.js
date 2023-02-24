const core = require('@actions/core');
const axios = require('axios');
const config = require('./config');

function formatAlerts(alerts) {
  let alertLines = '';
  alerts.forEach((alert) => {
    alertLines += `<https://github.com/${config.owner}/${config.repo}/issues/${alert.id}|${alert.title}> - ${alert.reactions} reactions\n`;
  });

  const postMessageBody = {
    channel: config.slackChannel,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `The following issues have received more than ${config.alertThreshold} reactions in the configured time interval:`,
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

  return postMessageBody;
}

function sendAlerts(body) {
  axios({
    method: 'post',
    url: 'https://slack.com/api/chat.postMessage',
    headers: { Authorization: `Bearer ${config.slackToken}` },
    data: body,
  })
    .then((res) => {
      core.info(`Slack Response: ${res.statusCode}`);
      core.info(JSON.stringify(res.data));
    })
    .catch((error) => {
      core.setFailed(`Posting to slack failed with error ${error}`);
    });
}

module.exports = {
  sendAlerts,
  formatAlerts,
};
