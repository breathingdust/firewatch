# Firewatch

GitHub Action designed to monitor a GitHub repository and alert a Slack channel if any issues accrues more than a configured amount of reactions in a configured interval. This is likely only useful for large repositories, but has proved useful on the Terraform AWS Provider repository.

## Description

In order to compare reactions from one interval to another this action will pull down all issues within a set timeframe `issue_age_months` and persist that information to a file so that the next run of the action can pick it up. The GitHub API does not offer a way to upload an artifact within the context of a current job, so a following [upload-artifact](https://github.com/actions/upload-artifact) step is required.

In summary, the process occurs as follows:

- Check for an existing data file, download it and read it to memory it if it exists.
- Pull all issues for the specified time period and save it to a file.
- Compare the historical data with the current data, and if any issue has accrued more reactions than the configured threshold [alert_threshold]() add it to an alert set.
- If the alert set is not empty, post a message to the configured Slack channel detailing the issue.

## Getting Started

Here is an example configuration, setting an hourly check for the last 3 months of data, and alerting if an issues gains more than 10 upvotes in the configured interval.

```yaml
on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:
name: Firewatch
jobs:
  FirewatchJob:
    if: github.repository_owner == 'owner'
    runs-on: ubuntu-latest
    steps:
      - name: Firewatch
        uses: breathingdust/firewatch@v2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          alert_threshold: 10
          issue_age_months: 3
          slack_token: ${{ secrets.SLACK_BOT_TOKEN }}
          slack_channel: ${{ secrets.SLACK_CHANNEL }}
      - name: UploadArtifact
        uses: actions/upload-artifact@v3
        with:
          name: firewatch
          path: firewatch.data
          if-no-files-found: error
          retention-days: 1
```
