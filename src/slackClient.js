import * as core from '@actions/core'
import axios from 'axios'
import config from './config.js'

export function formatAlerts(alerts) {
  let alertLines = ''
  alerts.forEach((alert) => {
    alertLines += `<https://github.com/${config.owner}/${config.repo}/issues/${alert.id}|${alert.title}> - ${alert.reactions} reactions\n`
  })

  const postMessageBody = {
    channel: config.slackChannel,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `The following issues have received more than ${config.alertThreshold} reactions in the configured time interval:`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: alertLines
        }
      }
    ]
  }

  core.info(JSON.stringify(postMessageBody))

  return postMessageBody
}

export function sendAlerts(body) {
  return axios({
    method: 'post',
    url: 'https://slack.com/api/chat.postMessage',
    headers: { Authorization: `Bearer ${config.slackToken}` },
    data: body
  })
    .then((res) => {
      core.info(`Slack Response: ${res.status}`)
      core.info(JSON.stringify(res.data))
    })
    .catch((error) => {
      core.setFailed(`Posting to slack failed with error ${error}`)
    })
}
