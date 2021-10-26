import unfetch from 'isomorphic-unfetch'
import { toRegexPattern } from './dict'
import { kan2num } from './kan2num'
import { currentConfig } from '../config'
import LRU from 'lru-cache'

type PrefectureList = { [key: string]: string[] }
interface SingleTown {
  town: string
  koaza: string
  lat: string
  lng: string
}
type TownList = SingleTown[]

const cachedTownRegexes = new LRU<string, [SingleTown, string][]>({
  max: currentConfig.townCacheSize,
  maxAge: 60 * 60 * 24 * 7, // 7日間
})

let cachedPrefecturePatterns: [string, string][] | undefined = undefined
const cachedCityPatterns: { [key: string]: [string, string][] } = {}
let cachedPrefectures: PrefectureList | undefined = undefined
const cachedTowns: { [key: string]: TownList } = {}

export const getPrefectures = async () => {
  if (typeof cachedPrefectures !== 'undefined') {
    return cachedPrefectures
  }

  const resp = await unfetch(`${currentConfig.japaneseAddressesApi}.json`)
  const data = (await resp.json()) as PrefectureList
  return (cachedPrefectures = data)
}

export const getPrefectureRegexPatterns = (prefs: string[]) => {
  if (cachedPrefecturePatterns) {
    return cachedPrefecturePatterns
  }

  cachedPrefecturePatterns = prefs.map((pref) => {
    const _pref = pref.replace(/(都|道|府|県)$/, '') // `東京` の様に末尾の `都府県` が抜けた住所に対応
    const pattern = `^${_pref}(都|道|府|県)?`
    return [pref, pattern]
  })

  return cachedPrefecturePatterns
}

export const getCityRegexPatterns = (pref: string, cities: string[]) => {
  const cachedResult = cachedCityPatterns[pref]
  if (typeof cachedResult !== 'undefined') {
    return cachedResult
  }

  // 少ない文字数の地名に対してミスマッチしないように文字の長さ順にソート
  cities.sort((a: string, b: string) => {
    return b.length - a.length
  })

  const patterns = cities.map((city) => {
    let pattern = `^${toRegexPattern(city)}`
    if (city.match(/(町|村)$/)) {
      pattern = `^${toRegexPattern(city).replace(/(.+?)郡/, '($1郡)?')}` // 郡が省略されてるかも
    }
    return [city, pattern] as [string, string]
  })

  cachedCityPatterns[pref] = patterns
  return patterns
}

export const getTowns = async (pref: string, city: string) => {
  const cacheKey = `${pref}-${city}`
  const cachedTown = cachedTowns[cacheKey]
  if (typeof cachedTown !== 'undefined') {
    return cachedTown
  }

  const responseTownsResp = await unfetch(
    [
      currentConfig.japaneseAddressesApi,
      encodeURI(pref),
      encodeURI(city) + '.json',
    ].join('/'),
  )
  const towns = (await responseTownsResp.json()) as TownList
  return (cachedTowns[cacheKey] = towns)
}

export const getTownRegexPatterns = async (pref: string, city: string) => {
  const cachedResult = cachedTownRegexes.get(`${pref}-${city}`)
  if (typeof cachedResult !== 'undefined') {
    return cachedResult
  }

  const towns = await getTowns(pref, city)

  // 少ない文字数の地名に対してミスマッチしないように文字の長さ順にソート
  towns.sort((a, b) => {
    return b.town.length - a.town.length
  })

  const patterns = towns.map((town) => {
    const pattern = toRegexPattern(
      town.town
        .replace(/大?字/g, '(大?字)?')
        // 以下住所マスターの町丁目に含まれる数字を正規表現に変換する
        .replace(
          /([壱一二三四五六七八九十]+)(丁目?|番(町|丁)|条|軒|線|(の|ノ)町|地割)/g,
          (match: string) => {
            const patterns = []

            patterns.push(
              match
                .toString()
                .replace(/(丁目?|番(町|丁)|条|軒|線|(の|ノ)町|地割)/, ''),
            ) // 漢数字

            if (match.match(/^壱/)) {
              patterns.push('一')
              patterns.push('1')
              patterns.push('１')
            } else {
              const num = match
                .replace(/([一二三四五六七八九十]+)/g, (match) => {
                  return kan2num(match)
                })
                .replace(/(丁目?|番(町|丁)|条|軒|線|(の|ノ)町|地割)/, '')

              patterns.push(num.toString()) // 半角アラビア数字
            }

            // 以下の正規表現は、上のよく似た正規表現とは違うことに注意！
            const _pattern = `(${patterns.join(
              '|',
            )})((丁|町)目?|番(町|丁)|条|軒|線|の町?|地割|[-－﹣−‐⁃‑‒–—﹘―⎯⏤ーｰ─━])`

            return _pattern // デバッグのときにめんどくさいので変数に入れる。
          },
        ),
    )

    if (city.match(/^京都市/)) {
      return [town, `.*${pattern}`]
    } else {
      return [town, `^${pattern}`]
    }
  }) as [SingleTown, string][]

  cachedTownRegexes.set(`${pref}-${city}`, patterns)
  return patterns
}