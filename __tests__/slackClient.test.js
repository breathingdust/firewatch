/**
 * Unit tests for src/slackClient.js
 */
import { jest } from '@jest/globals'
import * as mockCore from '../__fixtures__/core.js'

const mockAxios = jest.fn()

const inputs = {
  slack_channel: 'C123',
  slack_token: 'xoxb-token',
  alert_threshold: '10'
}
mockCore.getInput.mockImplementation((name) => inputs[name] ?? '')

jest.unstable_mockModule('@actions/core', () => mockCore)
jest.unstable_mockModule('axios', () => ({ default: mockAxios }))

process.env.GITHUB_REPOSITORY = 'owner/repo'

const slackClient = await import('../src/slackClient.js')

const alerts = [{ id: 1, title: 'title', reactions: 54 }]

describe('formatAlerts', () => {
  it('formats the header', () => {
    const body = slackClient.formatAlerts(alerts)

    expect(body.channel).toBe('C123')
    expect(body.blocks[0].text.text).toBe(
      'The following issues have received more than 10 reactions in the configured time interval:'
    )
  })

  it('formats each alert as a link', () => {
    const body = slackClient.formatAlerts([
      ...alerts,
      { id: 2, title: 'other', reactions: 12 }
    ])

    expect(body.blocks[2].text.text).toBe(
      '<https://github.com/owner/repo/issues/1|title> - 54 reactions\n' +
        '<https://github.com/owner/repo/issues/2|other> - 12 reactions\n'
    )
  })
})

describe('sendAlerts', () => {
  beforeEach(() => {
    mockAxios.mockReset()
  })

  it('posts the message to Slack with the bot token', async () => {
    mockAxios.mockResolvedValue({ status: 200, data: { ok: true } })
    const body = slackClient.formatAlerts(alerts)

    await slackClient.sendAlerts(body)

    expect(mockAxios).toHaveBeenCalledWith({
      method: 'post',
      url: 'https://slack.com/api/chat.postMessage',
      headers: { Authorization: 'Bearer xoxb-token' },
      data: body
    })
    expect(mockCore.info).toHaveBeenCalledWith('Slack Response: 200')
    expect(mockCore.setFailed).not.toHaveBeenCalled()
  })

  it('fails the action when the Slack request fails', async () => {
    mockAxios.mockRejectedValue(new Error('network down'))

    await slackClient.sendAlerts({})

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      'Posting to slack failed with error Error: network down'
    )
  })
})
