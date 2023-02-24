const core = require('@actions/core');

const [owner, repo] =
  process.env.NODE_ENV !== 'test'
    ? process.env.GITHUB_REPOSITORY.split('/')
    : ['', ''];

module.exports = {
  githubToken: core.getInput('github_token'),
  alertThreshold: core.getInput('alert_threshold'),
  issueAgeMonths: core.getInput('issue_age_months'),
  slackToken: core.getInput('slack_token'),
  slackChannel: core.getInput('slack_channel'),
  owner,
  repo,
  firewatchData: 'firewatch.data',
  firewatchZip: 'firewatch.zip',
  artifactFormatVerson: '1.0',
};
