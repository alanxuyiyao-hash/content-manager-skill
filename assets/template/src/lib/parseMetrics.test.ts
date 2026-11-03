import { describe, it, expect } from 'vitest'
import { parseMetrics } from './parseMetrics'

describe('parseMetrics — 平台后台文本解析', () => {
  it('中文小红书风格（万 + 千分位）', () => {
    const r = parseMetrics('播放 5.2万  点赞 1,200  收藏 380  涨粉 64')
    expect(r).toEqual({ views: 52000, likes: 1200, favorites: 380, followersGained: 64 })
  })

  it('英文风格（千分位逗号）', () => {
    const r = parseMetrics('Views 52,000  Likes 1,200  Favorites 380  Followers gained 64')
    expect(r).toEqual({ views: 52000, likes: 1200, favorites: 380, followersGained: 64 })
  })

  it('B站风格（换行 + 冒号）', () => {
    const r = parseMetrics('播放量：83000\n点赞数：2100\n收藏数：450\n新增粉丝：120')
    expect(r).toEqual({ views: 83000, likes: 2100, favorites: 450, followersGained: 120 })
  })

  it('k/m 后缀', () => {
    const r = parseMetrics('Views 52k  Likes 1.2k  Saves 380  New followers 64')
    expect(r).toEqual({ views: 52000, likes: 1200, favorites: 380, followersGained: 64 })
  })

  it('亿量级播放', () => {
    const r = parseMetrics('播放 1.2亿  点赞 38000')
    expect(r).toEqual({ views: 120000000, likes: 38000 })
  })

  it('部分字段缺失只返回匹配到的', () => {
    const r = parseMetrics('播放量 99000  点赞 200')
    expect(r).toEqual({ views: 99000, likes: 200 })
    expect(r.favorites).toBeUndefined()
    expect(r.followersGained).toBeUndefined()
  })

  it('无任何关键词匹配返回空对象', () => {
    const r = parseMetrics('这是一段没有任何指标的纯文本')
    expect(r).toEqual({})
  })

  it('空文本返回空对象', () => {
    expect(parseMetrics('')).toEqual({})
    expect(parseMetrics('   ')).toEqual({})
  })

  it('「关注」不误匹配成 followers（需要增量语义）', () => {
    // 纯「关注」不带增量词不应匹配（避免把"关注按钮"之类误读）
    const r = parseMetrics('关注 500  播放 1000')
    expect(r.views).toBe(1000)
    expect(r.followersGained).toBeUndefined()
  })

  it('「赞」单独出现也能匹配 likes', () => {
    const r = parseMetrics('赞 3800')
    expect(r.likes).toBe(3800)
  })

  it('同一指标多次出现取最后一个（后台常列历史 + 最新）', () => {
    const r = parseMetrics('播放 30000  播放 52000')
    expect(r.views).toBe(52000)
  })

  it('数字带空格量级（中文习惯 "12.5 万"）', () => {
    const r = parseMetrics('播放量 12.5 万，点赞 4300')
    expect(r.views).toBe(125000)
    expect(r.likes).toBe(4300)
  })
})
