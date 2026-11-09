/**
 * Unit tests for the action's main functionality, src/main.js
 */
import { jest } from '@jest/globals'
import * as mockCore from '../__fixtures__/core.js'

const mockOctokit = {
  paginate: jest.fn(),
  request: jest.fn()
}
const mockGetOctokit = jest.fn(() => mockOctokit)

const mockSlack = {
  formatAlerts: jest.fn(() => ({ formatted: true })),
  sendAlerts: jest.fn()
}

const mockExtractEntryTo = jest.fn()
const mockZip = jest.fn(() => ({ extractEntryTo: mockExtractEntryTo }))

const mockFs = {
  existsSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}

const inputs = {
  github_token: 'gh-token',
  alert_threshold: '10',
  issue_age_months: '3'
}
mockCore.getInput.mockImplementation((name) => inputs[name] ?? '')

jest.unstable_mockModule('@actions/core', () => mockCore)
jest.unstable_mockModule('@actions/github', () => ({
  getOctokit: mockGetOctokit
}))
jest.unstable_mockModule('../src/slackClient.js', () => mockSlack)
jest.unstable_mockModule('adm-zip', () => ({ default: mockZip }))
jest.unstable_mockModule('fs', () => ({
  default: mockFs,
  promises: mockFs.promises
}))

process.env.GITHUB_REPOSITORY = 'owner/repo'

const { run } = await import('../src/main.js')

/** Sets up octokit.paginate responses for the artifacts and issues routes. */
function mockGitHub({ artifacts = [], issues = [] } = {}) {
  mockOctokit.paginate.mockImplementation(async (route) => {
    if (route === 'GET /repos/{owner}/{repo}/actions/artifacts')
      return artifacts
    if (route === 'GET /search/issues') return issues
    throw new Error(`Unexpected route ${route}`)
  })
}

/** Makes a previous firewatch.data file available with the given entries. */
function mockPreviousData(entries, version = '1.0') {
  mockFs.existsSync.mockReturnValue(true)
  mockFs.promises.readFile.mockResolvedValue(
    JSON.stringify({ version, data: entries })
  )
}

const issue = (number, reactions, title = `issue ${number}`) => ({
  number,
  title,
  reactions: { total_count: reactions }
})

describe('main.js', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCore.getInput.mockImplementation((name) => inputs[name] ?? '')
    mockFs.existsSync.mockReturnValue(false)
    mockFs.promises.writeFile.mockResolvedValue()
    mockGetOctokit.mockImplementation(() => mockOctokit)
    mockSlack.formatAlerts.mockReturnValue({ formatted: true })
  })

  it('writes current data and sends no alerts on the first run', async () => {
    mockGitHub({ issues: [issue(1, 50), issue(2, 5)] })

    await run()

    expect(mockGetOctokit).toHaveBeenCalledWith('gh-token')
    expect(mockCore.info).toHaveBeenCalledWith('No previous file found.')
    expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
      'firewatch.data',
      JSON.stringify({
        version: '1.0',
        data: [
          [1, { reactions: 50, title: 'issue 1', id: 1 }],
          [2, { reactions: 5, title: 'issue 2', id: 2 }]
        ]
      })
    )
    expect(mockSlack.sendAlerts).not.toHaveBeenCalled()
    expect(mockCore.setFailed).not.toHaveBeenCalled()
  })

  it('searches open issues in the repo within the configured age', async () => {
    mockGitHub()

    await run()

    const [, params] = mockOctokit.paginate.mock.calls.find(
      ([route]) => route === 'GET /search/issues'
    )
    expect(params.per_page).toBe(100)
    expect(params.q).toMatch(
      /^is:open repo:owner\/repo created:>\d{4}-\d{2}-\d{2}$/
    )
  })

  it('downloads and extracts the newest unexpired firewatch artifact', async () => {
    mockGitHub({
      artifacts: [
        {
          name: 'firewatch',
          expired: false,
          created_at: '2026-01-01T00:00:00Z',
          archive_download_url: 'https://example.com/old'
        },
        {
          name: 'firewatch',
          expired: false,
          created_at: '2026-02-01T00:00:00Z',
          archive_download_url: 'https://example.com/new'
        },
        {
          name: 'firewatch',
          expired: true,
          created_at: '2026-03-01T00:00:00Z',
          archive_download_url: 'https://example.com/expired'
        },
        {
          name: 'other',
          expired: false,
          created_at: '2026-04-01T00:00:00Z',
          archive_download_url: 'https://example.com/other'
        }
      ]
    })
    mockOctokit.request.mockResolvedValue({ data: new ArrayBuffer(4) })

    await run()

    expect(mockOctokit.request).toHaveBeenCalledWith(
      'GET https://example.com/new'
    )
    expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
      'firewatch.zip',
      expect.any(Buffer)
    )
    expect(mockZip).toHaveBeenCalledWith('firewatch.zip')
    expect(mockExtractEntryTo).toHaveBeenCalledWith(
      'firewatch.data',
      './',
      true,
      true
    )
  })

  it('fails when the previous artifact cannot be downloaded', async () => {
    mockOctokit.paginate.mockImplementation(async (route) => {
      if (route === 'GET /search/issues') return []
      throw new Error('API Error')
    })

    await run()

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      'Unable to download previous artifact: Error: API Error.'
    )
  })

  it('alerts on issues whose reactions changed by more than the threshold', async () => {
    mockPreviousData([
      [1, { reactions: 10, title: 'issue 1', id: 1 }],
      [2, { reactions: 10, title: 'issue 2', id: 2 }],
      [3, { reactions: 30, title: 'issue 3', id: 3 }]
    ])
    // 1: +15 (alert), 2: +10 (not above threshold), 3: -15 (alert)
    mockGitHub({ issues: [issue(1, 25), issue(2, 20), issue(3, 15)] })

    await run()

    expect(mockCore.info).toHaveBeenCalledWith(
      'Firewatch data loaded successfully.'
    )
    expect(mockCore.info).toHaveBeenCalledWith('Existing map has 3 entries.')
    expect(mockSlack.formatAlerts).toHaveBeenCalledWith([
      { reactions: 25, title: 'issue 1', id: 1 },
      { reactions: 15, title: 'issue 3', id: 3 }
    ])
    expect(mockSlack.sendAlerts).toHaveBeenCalledWith({ formatted: true })
  })

  it('alerts on new issues with more reactions than the threshold', async () => {
    mockPreviousData([[1, { reactions: 1, title: 'issue 1', id: 1 }]])
    mockGitHub({ issues: [issue(1, 1), issue(2, 11), issue(3, 10)] })

    await run()

    expect(mockSlack.formatAlerts).toHaveBeenCalledWith([
      { reactions: 11, title: 'issue 2', id: 2 }
    ])
  })

  it('ignores previous data with a different format version', async () => {
    mockPreviousData([[1, { reactions: 0, title: 'issue 1', id: 1 }]], '0.9')
    mockGitHub({ issues: [issue(1, 100)] })

    await run()

    expect(mockCore.info).toHaveBeenCalledWith(
      'Previous artifact has a different version format.'
    )
    expect(mockSlack.sendAlerts).not.toHaveBeenCalled()
  })

  it('fails when previous data cannot be parsed', async () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.promises.readFile.mockResolvedValue('not json')
    mockGitHub()

    await run()

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining(
        "Getting existing data from 'firewatch.data' failed with error"
      )
    )
  })

  it('fails when current data cannot be written', async () => {
    mockGitHub()
    mockFs.promises.writeFile.mockRejectedValue(new Error('disk full'))

    await run()

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      'Writing to firewatch.data failed with error Error: disk full.'
    )
  })

  it('fails the action on unexpected errors', async () => {
    mockGitHub()
    mockOctokit.paginate.mockRejectedValue(new Error('search failed'))

    await run()

    expect(mockCore.setFailed).toHaveBeenCalledWith('search failed')
  })
})
