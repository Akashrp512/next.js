/* eslint-env jest */

import path from 'path'
import fs from 'fs-extra'
import {
  runNextCommand,
  launchApp,
  findPort,
  killApp,
  waitFor,
  nextBuild,
  nextLint,
  check,
  findAllTelemetryEvents,
} from 'next-test-utils'

const appDir = path.join(__dirname, '..')

describe('Telemetry CLI', () => {
  it('can print telemetry status', async () => {
    const { stdout } = await runNextCommand(['telemetry'], {
      stdout: true,
    })
    expect(stdout).toMatch(/Status: .*/)
  })

  it('can enable telemetry with flag', async () => {
    const { stdout } = await runNextCommand(['telemetry', '--enable'], {
      stdout: true,
    })
    expect(stdout).toMatch(/Success/)
    expect(stdout).toMatch(/Status: Enabled/)
  })

  it('can disable telemetry with flag', async () => {
    const { stdout } = await runNextCommand(['telemetry', '--disable'], {
      stdout: true,
    })
    expect(stdout).toMatch(/Your preference has been saved/)
    expect(stdout).toMatch(/Status: Disabled/)
  })

  it('can enable telemetry without flag', async () => {
    const { stdout } = await runNextCommand(['telemetry', 'enable'], {
      stdout: true,
    })
    expect(stdout).toMatch(/Success/)
    expect(stdout).toMatch(/Status: Enabled/)
  })

  it('can re-enable telemetry', async () => {
    const { stdout } = await runNextCommand(['telemetry', 'enable'], {
      stdout: true,
    })
    expect(stdout).toMatch(/Success/)
    expect(stdout).toMatch(/Status: Enabled/)
  })

  it('can disable telemetry without flag', async () => {
    const { stdout } = await runNextCommand(['telemetry', 'disable'], {
      stdout: true,
    })
    expect(stdout).toMatch(/Your preference has been saved/)
    expect(stdout).toMatch(/Status: Disabled/)
  })

  it('can re-disable telemetry', async () => {
    const { stdout } = await runNextCommand(['telemetry', 'disable'], {
      stdout: true,
    })
    expect(stdout).toMatch(/already disabled/)
    expect(stdout).toMatch(/Status: Disabled/)
  })

  it('can disable telemetry with env NEXT_TELEMETRY_DISABLED', async () => {
    // next config is not reset between tests
    await runNextCommand(['telemetry', 'enable'])
    const { stdout } = await runNextCommand(['telemetry', 'status'], {
      stdout: true,
      env: {
        NEXT_TELEMETRY_DISABLED: '1',
      },
    })
    expect(stdout).toMatch(/Status: Disabled/)
  })

  it('detects isSrcDir dir correctly for `next build`', async () => {
    // must clear cache for GSSP imports to be detected correctly
    await fs.remove(path.join(appDir, '.next'))
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })

    expect(stderr).toMatch(/isSrcDir.*?false/)
    expect(stderr).toMatch(/package.*?"fs"/)
    expect(stderr).toMatch(/package.*?"path"/)
    expect(stderr).toMatch(/package.*?"http"/)
    expect(stderr).toMatch(/NEXT_PACKAGE_USED_IN_GET_SERVER_SIDE_PROPS/)

    await fs.move(path.join(appDir, 'pages'), path.join(appDir, 'src/pages'))
    const { stderr: stderr2 } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await fs.move(path.join(appDir, 'src/pages'), path.join(appDir, 'pages'))

    expect(stderr2).toMatch(/isSrcDir.*?true/)
  })

  it('emits event when swc fails to load', async () => {
    await fs.remove(path.join(appDir, '.next'))
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        // block swc from loading
        NODE_OPTIONS: '--no-addons',
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    expect(stderr).toMatch(/NEXT_SWC_LOAD_FAILURE/)
    expect(stderr).toContain(
      `"nextVersion": "${require('next/package.json').version}"`
    )
    expect(stderr).toContain(`"arch": "${process.arch}"`)
    expect(stderr).toContain(`"platform": "${process.platform}"`)
    expect(stderr).toContain(`"nodeVersion": "${process.versions.node}"`)
  })

  it('logs completed `next build` with warnings', async () => {
    await fs.rename(
      path.join(appDir, 'pages', 'warning.skip'),
      path.join(appDir, 'pages', 'warning.js')
    )
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await fs.rename(
      path.join(appDir, 'pages', 'warning.js'),
      path.join(appDir, 'pages', 'warning.skip')
    )

    expect(stderr).toMatch(/Compiled with warnings/)
    expect(stderr).toMatch(/NEXT_BUILD_COMPLETED/)
  })

  it('detects tests correctly for `next build`', async () => {
    await fs.rename(
      path.join(appDir, 'pages', 'hello.test.skip'),
      path.join(appDir, 'pages', 'hello.test.js')
    )
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await fs.rename(
      path.join(appDir, 'pages', 'hello.test.js'),
      path.join(appDir, 'pages', 'hello.test.skip')
    )

    const event1 = /NEXT_BUILD_COMPLETED[\s\S]+?{([\s\S]+?)}/.exec(stderr).pop()
    expect(event1).toMatch(/hasDunderPages.*?true/)
    expect(event1).toMatch(/hasTestPages.*?true/)

    const event2 = /NEXT_BUILD_OPTIMIZED[\s\S]+?{([\s\S]+?)}/.exec(stderr).pop()
    expect(event2).toMatch(/hasDunderPages.*?true/)
    expect(event2).toMatch(/hasTestPages.*?true/)
  })

  it('detects correct cli session defaults', async () => {
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })

    const event = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
      .exec(stderr)
      .pop()

    expect(event).toMatch(/"hasNextConfig": false/)
    expect(event).toMatch(/"buildTarget": "default"/)
    expect(event).toMatch(/"hasWebpackConfig": false/)
    expect(event).toMatch(/"hasBabelConfig": false/)
  })

  it('cli session: babel tooling config', async () => {
    await fs.rename(
      path.join(appDir, '.babelrc.default'),
      path.join(appDir, '.babelrc')
    )
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await fs.rename(
      path.join(appDir, '.babelrc'),
      path.join(appDir, '.babelrc.default')
    )

    const event = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
      .exec(stderr)
      .pop()

    expect(event).toMatch(/"hasNextConfig": false/)
    expect(event).toMatch(/"buildTarget": "default"/)
    expect(event).toMatch(/"hasWebpackConfig": false/)
    expect(event).toMatch(/"hasBabelConfig": false/)
  })

  it('cli session: custom babel config (plugin)', async () => {
    await fs.rename(
      path.join(appDir, '.babelrc.plugin'),
      path.join(appDir, '.babelrc')
    )
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await fs.rename(
      path.join(appDir, '.babelrc'),
      path.join(appDir, '.babelrc.plugin')
    )

    const event = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
      .exec(stderr)
      .pop()

    expect(event).toMatch(/"hasNextConfig": false/)
    expect(event).toMatch(/"buildTarget": "default"/)
    expect(event).toMatch(/"hasWebpackConfig": false/)
    expect(event).toMatch(/"hasBabelConfig": true/)
  })

  it('cli session: package.json custom babel config (plugin)', async () => {
    await fs.rename(
      path.join(appDir, 'package.babel'),
      path.join(appDir, 'package.json')
    )
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await fs.rename(
      path.join(appDir, 'package.json'),
      path.join(appDir, 'package.babel')
    )

    const event = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
      .exec(stderr)
      .pop()

    expect(event).toMatch(/"hasNextConfig": false/)
    expect(event).toMatch(/"buildTarget": "default"/)
    expect(event).toMatch(/"hasWebpackConfig": false/)
    expect(event).toMatch(/"hasBabelConfig": true/)
  })

  it('cli session: custom babel config (preset)', async () => {
    await fs.rename(
      path.join(appDir, '.babelrc.preset'),
      path.join(appDir, '.babelrc')
    )
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await fs.rename(
      path.join(appDir, '.babelrc'),
      path.join(appDir, '.babelrc.preset')
    )

    const event = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
      .exec(stderr)
      .pop()

    expect(event).toMatch(/"hasNextConfig": false/)
    expect(event).toMatch(/"buildTarget": "default"/)
    expect(event).toMatch(/"hasWebpackConfig": false/)
    expect(event).toMatch(/"hasBabelConfig": true/)
  })

  it('cli session: next config with webpack', async () => {
    await fs.rename(
      path.join(appDir, 'next.config.webpack'),
      path.join(appDir, 'next.config.js')
    )
    const { stderr } = await runNextCommand(['build', appDir], {
      stderr: true,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await fs.rename(
      path.join(appDir, 'next.config.js'),
      path.join(appDir, 'next.config.webpack')
    )

    const event = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
      .exec(stderr)
      .pop()

    expect(event).toMatch(/"hasNextConfig": true/)
    expect(event).toMatch(/"buildTarget": "default"/)
    expect(event).toMatch(/"hasWebpackConfig": true/)
    expect(event).toMatch(/"hasBabelConfig": false/)
  })

  it('detect static 404 correctly for `next build`', async () => {
    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    const event1 = /NEXT_BUILD_OPTIMIZED[\s\S]+?{([\s\S]+?)}/.exec(stderr).pop()
    expect(event1).toMatch(/hasStatic404.*?true/)
  })

  it('detect page counts correctly for `next build`', async () => {
    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    const event1 = /NEXT_BUILD_OPTIMIZED[\s\S]+?{([\s\S]+?)}/.exec(stderr).pop()
    expect(event1).toMatch(/"staticPropsPageCount": 2/)
    expect(event1).toMatch(/"serverPropsPageCount": 2/)
    expect(event1).toMatch(/"ssrPageCount": 3/)
    expect(event1).toMatch(/"staticPageCount": 4/)
    expect(event1).toMatch(/"totalPageCount": 11/)
    expect(event1).toMatch(/"totalAppPagesCount": 0/)
    expect(event1).toMatch(/"staticAppPagesCount": 0/)
    expect(event1).toMatch(/"serverAppPagesCount": 0/)
    expect(event1).toMatch(/"edgeRuntimeAppCount": 0/)
    expect(event1).toMatch(/"edgeRuntimePagesCount": 2/)
  })

  it('detects isSrcDir dir correctly for `next dev`', async () => {
    let port = await findPort()
    let stderr = ''

    const handleStderr = (msg) => {
      stderr += msg
    }
    let app = await launchApp(appDir, port, {
      onStderr: handleStderr,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await waitFor(1000)
    await killApp(app)
    expect(stderr).toMatch(/isSrcDir.*?false/)

    await fs.move(path.join(appDir, 'pages'), path.join(appDir, 'src/pages'))
    stderr = ''

    port = await findPort()
    app = await launchApp(appDir, port, {
      onStderr: handleStderr,
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await waitFor(1000)
    await killApp(app)
    await fs.move(path.join(appDir, 'src/pages'), path.join(appDir, 'pages'))

    expect(stderr).toMatch(/isSrcDir.*?true/)
  })

  const setupAppDir = async () => {
    await fs.writeFile(
      path.join(__dirname, '../next.config.js'),
      'module.exports = { experimental: { appDir: true } }'
    )
    await fs.mkdir(path.join(__dirname, '../app'))
    await fs.writeFile(
      path.join(__dirname, '../app/layout.js'),
      `
      export default function RootLayout({ children }) {
        return <html>
          <head/>
          <body>{children}</body>
        </html>
      }
    `
    )
    await fs.ensureFile(path.join(__dirname, '../app/hello/page.js'))
    await fs.writeFile(
      path.join(__dirname, '../app/hello/page.js'),
      'export default function Page() { return "hello world" }'
    )

    return async function teardownAppDir() {
      await fs.remove(path.join(__dirname, '../app'))
      await fs.remove(path.join(__dirname, '../next.config.js'))
    }
  }

  it('detects --turbo correctly for `next dev`', async () => {
    let port = await findPort()
    let stderr = ''

    const teardown = await setupAppDir()

    try {
      const handleStderr = (msg) => {
        stderr += msg
      }
      let app = await launchApp(appDir, port, {
        onStderr: handleStderr,
        env: {
          NEXT_TELEMETRY_DEBUG: 1,
        },
        turbo: true,
      })
      await waitFor(1000)

      if (app) {
        await killApp(app)
      }
      const event1 = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
        .exec(stderr)
        .pop()

      expect(event1).toMatch(/"pagesDir": true/)
      expect(event1).toMatch(/"turboFlag": true/)
    } finally {
      await teardown()
    }
  })

  it('detects --turbo correctly for `next dev` stopped', async () => {
    let port = await findPort()
    let stderr = ''

    const teardown = await setupAppDir()

    try {
      const handleStderr = (msg) => {
        stderr += msg
      }
      let app = await launchApp(appDir, port, {
        onStderr: handleStderr,
        env: {
          NEXT_TELEMETRY_DEBUG: 1,
        },
        turbo: true,
      })

      if (app) {
        await killApp(app)
      }
      await check(() => stderr, /NEXT_CLI_SESSION_STOPPED/)

      const event1 = /NEXT_CLI_SESSION_STOPPED[\s\S]+?{([\s\S]+?)}/
        .exec(stderr)
        .pop()

      expect(event1).toMatch(/"pagesDir": true/)
      expect(event1).toMatch(/"turboFlag": true/)
    } finally {
      await teardown()
    }
  })

  it('detects correctly for `next dev` stopped (no turbo)', async () => {
    let port = await findPort()
    let stderr = ''

    const teardown = await setupAppDir()

    try {
      const handleStderr = (msg) => {
        stderr += msg
      }
      let app = await launchApp(appDir, port, {
        onStderr: handleStderr,
        env: {
          NEXT_TELEMETRY_DEBUG: 1,
        },
      })

      await check(() => stderr, /NEXT_CLI_SESSION_STARTED/)

      if (app) {
        await killApp(app)
      }
      await check(() => stderr, /NEXT_CLI_SESSION_STOPPED/)

      const event1 = /NEXT_CLI_SESSION_STOPPED[\s\S]+?{([\s\S]+?)}/
        .exec(stderr)
        .pop()

      expect(event1).toMatch(/"turboFlag": false/)
      expect(event1).toMatch(/"pagesDir": true/)
      expect(event1).toMatch(/"appDir": true/)
    } finally {
      await teardown()
    }
  })

  it('should detect app page counts', async () => {
    const teardown = await setupAppDir()

    try {
      await fs.ensureFile(path.join(__dirname, '../app/ssr/page.js'))
      await fs.writeFile(
        path.join(__dirname, '../app/ssr/page.js'),
        `
        export const revalidate = 0
        export default function Page() {
          return <p>ssr page</p>
        }
      `
      )
      await fs.ensureFile(path.join(__dirname, '../app/edge-ssr/page.js'))
      await fs.writeFile(
        path.join(__dirname, '../app/edge-ssr/page.js'),
        `
        export const runtime = 'experimental-edge'
        export default function Page() {
          return <p>edge-ssr page</p>
        }
      `
      )
      await fs.ensureFile(path.join(__dirname, '../app/app-ssg/[slug]/page.js'))
      await fs.writeFile(
        path.join(__dirname, '../app/app-ssg/[slug]/page.js'),
        `
        export function generateStaticParams() {
          return [
            { slug: 'post-1' },
            { slug: 'post-2' },
          ]
        }
        export default function Page() {
          return <p>ssg page</p>
        }
      `
      )
      const { stderr } = await nextBuild(appDir, [], {
        stderr: true,
        env: { NEXT_TELEMETRY_DEBUG: 1 },
      })

      const event1 = /NEXT_BUILD_OPTIMIZED[\s\S]+?{([\s\S]+?)}/
        .exec(stderr)
        .pop()
      expect(event1).toMatch(/"staticPropsPageCount": 2/)
      expect(event1).toMatch(/"serverPropsPageCount": 2/)
      expect(event1).toMatch(/"ssrPageCount": 3/)
      expect(event1).toMatch(/"staticPageCount": 4/)
      expect(event1).toMatch(/"totalPageCount": 11/)
      expect(event1).toMatch(/"totalAppPagesCount": 4/)
      expect(event1).toMatch(/"serverAppPagesCount": 2/)
      expect(event1).toMatch(/"edgeRuntimeAppCount": 1/)
      expect(event1).toMatch(/"edgeRuntimePagesCount": 2/)

      const event2 = /NEXT_BUILD_COMPLETED[\s\S]+?{([\s\S]+?)}/
        .exec(stderr)
        .pop()

      expect(event2).toMatch(/"totalAppPagesCount": 4/)
    } finally {
      await teardown()
    }
  })

  it('detect reportWebVitals correctly for `next build`', async () => {
    // Case 1: When _app.js does not exist.
    let build = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    let event1 = /NEXT_BUILD_OPTIMIZED[\s\S]+?{([\s\S]+?)}/
      .exec(build.stderr)
      .pop()
    expect(event1).toMatch(/hasReportWebVitals.*?false/)

    // Case 2: When _app.js exist with reportWebVitals function.
    await fs.utimes(
      path.join(appDir, 'pages', '_app_withreportwebvitals.empty'),
      new Date(),
      new Date()
    )
    await fs.rename(
      path.join(appDir, 'pages', '_app_withreportwebvitals.empty'),
      path.join(appDir, 'pages', '_app.js')
    )

    build = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    await fs.rename(
      path.join(appDir, 'pages', '_app.js'),
      path.join(appDir, 'pages', '_app_withreportwebvitals.empty')
    )

    event1 = /NEXT_BUILD_OPTIMIZED[\s\S]+?{([\s\S]+?)}/.exec(build.stderr).pop()
    expect(event1).toMatch(/hasReportWebVitals.*?true/)

    // Case 3: When _app.js exist without reportWebVitals function.
    await fs.utimes(
      path.join(appDir, 'pages', '_app_withoutreportwebvitals.empty'),
      new Date(),
      new Date()
    )
    await fs.rename(
      path.join(appDir, 'pages', '_app_withoutreportwebvitals.empty'),
      path.join(appDir, 'pages', '_app.js')
    )

    build = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    await fs.rename(
      path.join(appDir, 'pages', '_app.js'),
      path.join(appDir, 'pages', '_app_withoutreportwebvitals.empty')
    )

    event1 = /NEXT_BUILD_OPTIMIZED[\s\S]+?{([\s\S]+?)}/.exec(build.stderr).pop()
    expect(event1).toMatch(/hasReportWebVitals.*?false/)
  })

  it('detects rewrites, headers, and redirects for next build', async () => {
    await fs.rename(
      path.join(appDir, 'next.config.custom-routes'),
      path.join(appDir, 'next.config.js')
    )

    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    await fs.rename(
      path.join(appDir, 'next.config.js'),
      path.join(appDir, 'next.config.custom-routes')
    )

    const event1 = /NEXT_BUILD_OPTIMIZED[\s\S]+?{([\s\S]+?)}/.exec(stderr).pop()
    expect(event1).toMatch(/"headersCount": 1/)
    expect(event1).toMatch(/"rewritesCount": 2/)
    expect(event1).toMatch(/"redirectsCount": 1/)
    expect(event1).toMatch(/"middlewareCount": 0/)
  })

  it('detects i18n and image configs for session start', async () => {
    await fs.rename(
      path.join(appDir, 'next.config.i18n-images'),
      path.join(appDir, 'next.config.js')
    )

    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    await fs.rename(
      path.join(appDir, 'next.config.js'),
      path.join(appDir, 'next.config.i18n-images')
    )

    const event1 = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
      .exec(stderr)
      .pop()

    expect(event1).toMatch(/"i18nEnabled": true/)
    expect(event1).toMatch(/"locales": "en,nl,fr"/)
    expect(event1).toMatch(/"localeDomainsCount": 2/)
    expect(event1).toMatch(/"localeDetectionEnabled": true/)
    expect(event1).toMatch(/"imageEnabled": true/)
    expect(event1).toMatch(/"imageFutureEnabled": true/)
    expect(event1).toMatch(/"imageDomainsCount": 2/)
    expect(event1).toMatch(/"imageRemotePatternsCount": 1/)
    expect(event1).toMatch(/"imageSizes": "64,128,256,512,1024"/)
    expect(event1).toMatch(/"imageFormats": "image\/avif,image\/webp"/)
    expect(event1).toMatch(/"trailingSlashEnabled": false/)
    expect(event1).toMatch(/"reactStrictMode": false/)
    expect(event1).toMatch(/"turboFlag": false/)
    expect(event1).toMatch(/"pagesDir": true/)
    expect(event1).toMatch(/"appDir": false/)

    await fs.rename(
      path.join(appDir, 'next.config.i18n-images'),
      path.join(appDir, 'next.config.js')
    )

    let stderr2 = ''

    let app = await launchApp(appDir, await findPort(), {
      onStderr(msg) {
        stderr2 += msg || ''
      },
      env: {
        NEXT_TELEMETRY_DEBUG: 1,
      },
    })
    await waitFor(1000)
    await killApp(app)

    await fs.rename(
      path.join(appDir, 'next.config.js'),
      path.join(appDir, 'next.config.i18n-images')
    )

    const event2 = /NEXT_CLI_SESSION_STARTED[\s\S]+?{([\s\S]+?)}/
      .exec(stderr2)
      .pop()
    expect(event2).toMatch(/"i18nEnabled": true/)
    expect(event2).toMatch(/"locales": "en,nl,fr"/)
    expect(event2).toMatch(/"localeDomainsCount": 2/)
    expect(event2).toMatch(/"localeDetectionEnabled": true/)
    expect(event2).toMatch(/"imageDomainsCount": 2/)
    expect(event2).toMatch(/"imageRemotePatternsCount": 1/)
    expect(event2).toMatch(/"imageSizes": "64,128,256,512,1024"/)
    expect(event2).toMatch(/"trailingSlashEnabled": false/)
    expect(event2).toMatch(/"reactStrictMode": false/)
  })

  it('emits telemetry for lint during build', async () => {
    await fs.writeFile(
      path.join(appDir, '.eslintrc'),
      `{ "root": true, "extends": "next" }`
    )
    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })
    await fs.remove(path.join(appDir, '.eslintrc'))

    const event1 = /NEXT_LINT_CHECK_COMPLETED[\s\S]+?{([\s\S}]+?)^}/m
      .exec(stderr)
      .pop()

    expect(event1).toMatch(/"durationInSeconds": [\d]{1,}/)
    expect(event1).toMatch(/"eslintVersion": ".*?\..*?\..*?"/)
    expect(event1).toMatch(/"lintedFilesCount": [\d]{1,}/)
    expect(event1).toMatch(/"lintFix": false/)
    expect(event1).toMatch(/"buildLint": true/)
    expect(event1).toMatch(/"nextEslintPluginVersion": ".*?\..*?\..*?"/)
    expect(event1).toMatch(/"nextEslintPluginErrorsCount": \d{1,}/)
    expect(event1).toMatch(/"nextEslintPluginWarningsCount": \d{1,}/)
    expect(event1).toMatch(`"nextRulesEnabled": {`)
    expect(event1).toMatch(/"@next\/next\/.+?": "(off|warn|error)"/)

    const featureUsageEvents = findAllTelemetryEvents(
      stderr,
      'NEXT_BUILD_FEATURE_USAGE'
    )
    expect(featureUsageEvents).toContainEqual({
      featureName: 'build-lint',
      invocationCount: 1,
    })
  })

  it(`emits telemetry for lint during build when '--no-lint' is specified`, async () => {
    const { stderr } = await nextBuild(appDir, ['--no-lint'], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })
    const events = findAllTelemetryEvents(stderr, 'NEXT_BUILD_FEATURE_USAGE')
    expect(events).toContainEqual({
      featureName: 'build-lint',
      invocationCount: 0,
    })
  })

  it(`emits telemetry for lint during build when 'ignoreDuringBuilds' is specified`, async () => {
    const nextConfig = path.join(appDir, 'next.config.js')
    await fs.writeFile(
      nextConfig,
      `module.exports = { eslint: { ignoreDuringBuilds: true } }`
    )
    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })
    await fs.remove(nextConfig)

    const events = findAllTelemetryEvents(stderr, 'NEXT_BUILD_FEATURE_USAGE')
    expect(events).toContainEqual({
      featureName: 'build-lint',
      invocationCount: 0,
    })
  })

  it('emits telemetry for `next lint`', async () => {
    await fs.writeFile(
      path.join(appDir, '.eslintrc'),
      `{ "root": true, "extends": "next" }`
    )
    const { stderr } = await nextLint(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })
    await fs.remove(path.join(appDir, '.eslintrc'))

    const event1 = /NEXT_LINT_CHECK_COMPLETED[\s\S]+?{([\s\S]+?)^}/m
      .exec(stderr)
      .pop()

    expect(event1).toMatch(/"durationInSeconds": [\d]{1,}/)
    expect(event1).toMatch(/"eslintVersion": ".*?\..*?\..*?"/)
    expect(event1).toMatch(/"lintedFilesCount": [\d]{1,}/)
    expect(event1).toMatch(/"lintFix": false/)
    expect(event1).toMatch(/"buildLint": false/)
    expect(event1).toMatch(/"nextEslintPluginVersion": ".*?\..*?\..*?"/)
    expect(event1).toMatch(/"nextEslintPluginErrorsCount": \d{1,}/)
    expect(event1).toMatch(/"nextEslintPluginWarningsCount": \d{1,}/)
    expect(event1).toMatch(`"nextRulesEnabled": {`)
    expect(event1).toMatch(/"@next\/next\/.+?": "(off|warn|error)"/)
  })

  it('emits telemery for usage of optimizeFonts, image, script & dynamic', async () => {
    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })
    const featureUsageEvents = findAllTelemetryEvents(
      stderr,
      'NEXT_BUILD_FEATURE_USAGE'
    )

    expect(featureUsageEvents).toEqual(
      expect.arrayContaining([
        {
          featureName: 'optimizeFonts',
          invocationCount: 1,
        },
        {
          featureName: 'next/image',
          invocationCount: 2,
        },
        {
          featureName: 'next/script',
          invocationCount: 1,
        },
        {
          featureName: 'next/dynamic',
          invocationCount: 1,
        },
      ])
    )
  })

  it('emits telemetry for usage of swc', async () => {
    await fs.remove(path.join(appDir, 'next.config.js'))
    await fs.remove(path.join(appDir, 'jsconfig.json'))
    await fs.rename(
      path.join(appDir, 'next.config.swc'),
      path.join(appDir, 'next.config.js')
    )
    await fs.rename(
      path.join(appDir, 'jsconfig.swc'),
      path.join(appDir, 'jsconfig.json')
    )
    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })
    await fs.rename(
      path.join(appDir, 'next.config.js'),
      path.join(appDir, 'next.config.swc')
    )
    await fs.rename(
      path.join(appDir, 'jsconfig.json'),
      path.join(appDir, 'jsconfig.swc')
    )
    const featureUsageEvents = findAllTelemetryEvents(
      stderr,
      'NEXT_BUILD_FEATURE_USAGE'
    )
    expect(featureUsageEvents).toEqual(
      expect.arrayContaining([
        {
          featureName: 'swcLoader',
          invocationCount: 1,
        },
        {
          featureName: 'swcMinify',
          invocationCount: 1,
        },
        {
          featureName: 'swcRelay',
          invocationCount: 1,
        },
        {
          featureName: 'swcStyledComponents',
          invocationCount: 1,
        },
        {
          featureName: 'swcReactRemoveProperties',
          invocationCount: 1,
        },
        {
          featureName: 'swcExperimentalDecorators',
          invocationCount: 1,
        },
        {
          featureName: 'swcRemoveConsole',
          invocationCount: 1,
        },
        {
          featureName: 'swcImportSource',
          invocationCount: 0,
        },
      ])
    )
  })

  it('emits telemetry for usage of `optimizeCss`', async () => {
    await fs.rename(
      path.join(appDir, 'next.config.optimize-css'),
      path.join(appDir, 'next.config.js')
    )

    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    await fs.rename(
      path.join(appDir, 'next.config.js'),
      path.join(appDir, 'next.config.optimize-css')
    )

    const events = findAllTelemetryEvents(stderr, 'NEXT_BUILD_FEATURE_USAGE')
    expect(events).toContainEqual({
      featureName: 'experimental/optimizeCss',
      invocationCount: 1,
    })
  })

  it('emits telemetry for usage of `nextScriptWorkers`', async () => {
    await fs.rename(
      path.join(appDir, 'next.config.next-script-workers'),
      path.join(appDir, 'next.config.js')
    )

    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    await fs.rename(
      path.join(appDir, 'next.config.js'),
      path.join(appDir, 'next.config.next-script-workers')
    )

    const featureUsageEvents = findAllTelemetryEvents(
      stderr,
      'NEXT_BUILD_FEATURE_USAGE'
    )
    expect(featureUsageEvents).toContainEqual({
      featureName: 'experimental/nextScriptWorkers',
      invocationCount: 1,
    })
  })

  it('emits telemetry for usage of middleware', async () => {
    await fs.writeFile(
      path.join(appDir, 'middleware.js'),
      `export function middleware () { }`
    )

    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    await fs.remove(path.join(appDir, 'middleware.js'))

    const buildOptimizedEvents = findAllTelemetryEvents(
      stderr,
      'NEXT_BUILD_OPTIMIZED'
    )
    expect(buildOptimizedEvents).toContainEqual(
      expect.objectContaining({
        middlewareCount: 1,
      })
    )
  })

  it('emits telemetry for usage of swc plugins', async () => {
    await fs.remove(path.join(appDir, 'next.config.js'))
    await fs.remove(path.join(appDir, 'package.json'))

    await fs.rename(
      path.join(appDir, 'next.config.swc-plugins'),
      path.join(appDir, 'next.config.js')
    )

    await fs.rename(
      path.join(appDir, 'package.swc-plugins'),
      path.join(appDir, 'package.json')
    )

    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })

    await fs.rename(
      path.join(appDir, 'next.config.js'),
      path.join(appDir, 'next.config.swc-plugins')
    )

    await fs.rename(
      path.join(appDir, 'package.json'),
      path.join(appDir, 'package.swc-plugins')
    )

    const pluginDetectedEvents = findAllTelemetryEvents(
      stderr,
      'NEXT_SWC_PLUGIN_DETECTED'
    )
    expect(pluginDetectedEvents).toEqual([
      {
        pluginName: 'swc-plugin-coverage-instrument',
        pluginVersion: '0.0.6',
      },
      {
        pluginName: '@swc/plugin-relay',
        pluginVersion: '0.2.0',
      },
      {
        pluginName: '/test/absolute_path/plugin.wasm',
      },
    ])
  })

  it('emits telemetry for usage of next/legacy/image', async () => {
    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })
    const featureUsageEvents = findAllTelemetryEvents(
      stderr,
      'NEXT_BUILD_FEATURE_USAGE'
    )
    expect(featureUsageEvents).toContainEqual({
      featureName: 'next/legacy/image',
      invocationCount: 2,
    })
    expect(featureUsageEvents).toContainEqual({
      featureName: 'next/image',
      invocationCount: 2,
    })
  })

  it('emits telemetry for usage of @vercel/og', async () => {
    const { stderr } = await nextBuild(appDir, [], {
      stderr: true,
      env: { NEXT_TELEMETRY_DEBUG: 1 },
    })
    const featureUsageEvents = findAllTelemetryEvents(
      stderr,
      'NEXT_BUILD_FEATURE_USAGE'
    )
    expect(featureUsageEvents).toContainEqual({
      featureName: 'vercelImageGeneration',
      invocationCount: 1,
    })
  })
})
