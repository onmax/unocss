import type { Preset } from '@unocss/core'
import { toArray } from '@unocss/core'
import { LAYER_IMPORTS } from '../../core/src/constants'
import { BunnyFontsProvider } from './providers/bunny'
import { GoogleFontsProvider } from './providers/google'
import { FontshareProvider } from './providers/fontshare'
import { NoneProvider } from './providers/none'
import type { CustomFetchOptions, Provider, ResolvedWebFontMeta, WebFontMeta, WebFontsOptions, WebFontsProviders } from './types'
import { useLocalFont } from './local-font'

const builtinProviders = {
  google: GoogleFontsProvider,
  bunny: BunnyFontsProvider,
  fontshare: FontshareProvider,
  none: NoneProvider,
}

function resolveProvider(provider: WebFontsProviders): Provider {
  if (typeof provider === 'string')
    return builtinProviders[provider]
  return provider
}

export function normalizedFontMeta(meta: WebFontMeta | string, defaultProvider: WebFontsProviders): ResolvedWebFontMeta {
  if (typeof meta !== 'string') {
    meta.provider = resolveProvider(meta.provider || defaultProvider)
    if (meta.weights)
      meta.weights = [...new Set(meta.weights.sort((a, b) => a.toString().localeCompare(b.toString(), 'en', { numeric: true })))]
    return meta as ResolvedWebFontMeta
  }

  const [name, weights = ''] = meta.split(':')

  return {
    name,
    weights: [...new Set(weights.split(/[,;]\s*/).filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })))],
    provider: resolveProvider(defaultProvider),
  }
}

const userAgentWoff2 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36'
const defaultHeaders: HeadersInit = { 'User-Agent': userAgentWoff2 }

async function defaultFetch(url: string, { headers = defaultHeaders }: CustomFetchOptions = {}) {
  const { $fetch } = (await import('ofetch'))
  return await $fetch(url, { headers, retry: 3 })
}

export function createWebFontPreset() {
  return (options: WebFontsOptions = {}): Preset<any> => {
    const {
      provider: defaultProvider = 'google',
      extendTheme = true,
      inlineImports = true,
      themeKey = 'fontFamily',
      customFetch = defaultFetch,
      downloadLocally = false,
    } = options

    const fontObject = Object.fromEntries(
      Object.entries(options.fonts || {})
        .map(([name, meta]) => [name, toArray(meta).map(m => normalizedFontMeta(m, defaultProvider))]),
    )
    const fonts = Object.values(fontObject).flatMap(i => i)

    const importCache: Record<string, Promise<string>> = {}

    async function importUrl(url: string) {
      if (inlineImports) {
        if (!importCache[url]) {
          importCache[url] = customFetch(url).catch((e) => {
            console.error('Failed to fetch web fonts')
            console.error(e)
            // eslint-disable-next-line node/prefer-global/process
            if (typeof process !== 'undefined' && process.env.CI)
              throw e
          })
        }
        return await importCache[url]
      }
      else {
        return `@import url('${url}');`
      }
    }

    const enabledProviders = new Set(fonts.map(i => i.provider))

    const preset: Preset<any> = {
      name: '@unocss/preset-web-fonts',
      preflights: [
        {
          async getCSS() {
            const preflights: (string | undefined)[] = []

            for (const provider of enabledProviders) {
              const fontsForProvider = fonts.filter(i => i.provider.name === provider.name)

              if (provider.getImportUrl) {
                const url = provider.getImportUrl(fontsForProvider)
                if (url) {
                  let css = await importUrl(url)
                  if (downloadLocally)
                    css = await useLocalFont(css, customFetch)
                  preflights.push(css)
                }
              }

              preflights.push(provider.getPreflight?.(fontsForProvider))
            }

            return preflights.filter(Boolean).join('\n')
          },
          layer: inlineImports ? undefined : LAYER_IMPORTS,
        },
      ],
    }

    if (extendTheme) {
      preset.extendTheme = (theme) => {
        if (!theme[themeKey])
          theme[themeKey] = {}
        const obj = Object.fromEntries(
          Object.entries(fontObject)
            .map(([name, fonts]) => [name, fonts.map(f => f.provider.getFontName?.(f) ?? `"${f.name}"`)]),
        )
        for (const key of Object.keys(obj)) {
          if (typeof theme[themeKey][key] === 'string')
            theme[themeKey][key] = obj[key].map(i => `${i},`).join('') + theme[themeKey][key]
          else
            theme[themeKey][key] = obj[key].join(',')
        }
      }
    }
    return preset
  }
}
