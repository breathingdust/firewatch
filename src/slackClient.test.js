const slackClient = require('./slackClient');

describe('format alerts', () => {
  test('formats title successfully', async () => {
    const alerts = [{
      id: 1,
      title: 'title',
      reactions: 54,
    }];

    const body = slackClient.formatAlerts(alerts);

    expect(body.blocks[0].text.text).toEqual('The following issues have received more than  reactions in the configured time interval:');
  });

  test('formats alert successfully', async () => {
    const alerts = [{
      id: 1,
      title: 'title',
      reactions: 54,
    }];

    const body = slackClient.formatAlerts(alerts);

    expect(body.blocks[2].text.text).toStrictEqual('<https://github.com///issues/1|title> - 54 reactions\n');
  });
});
