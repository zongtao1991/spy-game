# 多人在线谁是卧底 PRD

## 项目背景
开发一个多人在线"谁是卧底"游戏，支持 4-8 人同时在线。玩家通过描述词语，投票找出卧底。

## 核心功能

### 1. 房间系统
- 创建/加入房间
- 房间列表
- 房间设置（人数）

### 2. 游戏流程
- 准备阶段
- 发词阶段
- 描述阶段（轮流发言）
- 投票阶段
- 结算阶段

### 3. 用户系统
- 注册/登录
- 历史战绩

## 技术栈
- Node.js + Express + Socket.IO + SQLite
- 前端：HTML5 + Bootstrap
- 端口：8765

## 数据模型
- User: id, username, password_hash, created_at
- WordPair: id, normal_word, spy_word, category
- Room: id, name, host_id, max_players, status, created_at
- GameRecord: id, room_id, winner, duration, created_at
- GamePlayer: id, game_record_id, user_id, role, word, is_alive

## 游戏规则
1. 4-8 人，1-2 个卧底
2. 每轮每人描述一句
3. 每轮投票淘汰一人
4. 胜利条件：卧底全死或卧底人数 >= 平民人数

## 页面
1. 首页：房间列表
2. 房间页：玩家列表、准备/开始
3. 游戏页：游戏界面、聊天
4. 个人页：战绩
