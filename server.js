const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const { initDatabase, getDb, saveDatabase, saveRoomToDb, saveRoomPlayersToDb, loadRoomsFromDb, deleteRoomFromDb } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 8765;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'spy-game-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const rooms = new Map();
const userSockets = new Map();

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomWordPair() {
    const db = getDb();
    const result = db.exec('SELECT * FROM word_pairs ORDER BY RANDOM() LIMIT 1');
    if (result.length > 0 && result[0].values.length > 0) {
        const row = result[0].values[0];
        return {
            id: row[0],
            normal_word: row[1],
            spy_word: row[2],
            category: row[3]
        };
    }
    return { normal_word: '苹果', spy_word: '梨子', category: '水果' };
}

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.json({ success: false, message: '用户名和密码不能为空' });
        }

        const db = getDb();
        
        const checkResult = db.exec('SELECT id FROM users WHERE username = ?', [username]);
        if (checkResult.length > 0 && checkResult[0].values.length > 0) {
            return res.json({ success: false, message: '用户名已存在' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
        saveDatabase();

        const userIdResult = db.exec('SELECT last_insert_rowid() as id');
        const userId = userIdResult[0].values[0][0];

        req.session.userId = userId;
        req.session.username = username;

        res.json({ success: true, message: '注册成功', user: { id: userId, username } });
    } catch (error) {
        console.error('注册错误:', error);
        res.json({ success: false, message: '注册失败' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.json({ success: false, message: '用户名和密码不能为空' });
        }

        const db = getDb();
        const result = db.exec('SELECT id, password_hash FROM users WHERE username = ?', [username]);
        
        if (result.length === 0 || result[0].values.length === 0) {
            return res.json({ success: false, message: '用户名或密码错误' });
        }

        const user = result[0].values[0];
        const passwordHash = user[1];
        
        const isMatch = await bcrypt.compare(password, passwordHash);
        if (!isMatch) {
            return res.json({ success: false, message: '用户名或密码错误' });
        }

        req.session.userId = user[0];
        req.session.username = username;

        res.json({ success: true, message: '登录成功', user: { id: user[0], username } });
    } catch (error) {
        console.error('登录错误:', error);
        res.json({ success: false, message: '登录失败' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/user', (req, res) => {
    if (req.session.userId) {
        let activeRoom = null;
        rooms.forEach((room, roomId) => {
            const player = room.players.find(p => p.userId === req.session.userId);
            if (player) {
                activeRoom = {
                    roomId: roomId,
                    roomName: room.name,
                    status: room.status,
                    gamePhase: room.gamePhase,
                    isHost: player.isHost,
                    myWord: player.word,
                    myRole: player.role,
                    myWordCategory: room.wordPair?.category
                };
            }
        });
        
        res.json({ 
            success: true, 
            user: { id: req.session.userId, username: req.session.username },
            activeRoom: activeRoom
        });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/rooms', (req, res) => {
    const roomList = [];
    rooms.forEach((room, roomId) => {
        roomList.push({
            id: roomId,
            name: room.name,
            hostId: room.hostId,
            maxPlayers: room.maxPlayers,
            currentPlayers: room.players.length,
            status: room.status
        });
    });
    res.json({ success: true, rooms: roomList });
});

app.get('/api/games/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const db = getDb();
        
        const result = db.exec(`
            SELECT gr.id, gr.room_id, gr.winner, gr.duration, gr.created_at,
                   gp.role, gp.word, gp.is_alive
            FROM game_records gr
            JOIN game_players gp ON gr.id = gp.game_record_id
            WHERE gp.user_id = ?
            ORDER BY gr.created_at DESC
            LIMIT 20
        `, [parseInt(userId)]);

        const games = [];
        if (result.length > 0) {
            result[0].values.forEach(row => {
                games.push({
                    id: row[0],
                    roomId: row[1],
                    winner: row[2],
                    duration: row[3],
                    createdAt: row[4],
                    role: row[5],
                    word: row[6],
                    isAlive: row[7],
                    isWin: row[2] === row[5] || (row[2] === '平民' && row[5] === '平民') || (row[2] === '卧底' && row[5] === '卧底')
                });
            });
        }

        const statsResult = db.exec(`
            SELECT 
                COUNT(*) as total_games,
                SUM(CASE WHEN (gr.winner = '平民' AND gp.role = '平民') OR (gr.winner = '卧底' AND gp.role = '卧底') THEN 1 ELSE 0 END) as wins
            FROM game_records gr
            JOIN game_players gp ON gr.id = gp.game_record_id
            WHERE gp.user_id = ?
        `, [parseInt(userId)]);

        let stats = { totalGames: 0, wins: 0, winRate: 0 };
        if (statsResult.length > 0 && statsResult[0].values.length > 0) {
            const row = statsResult[0].values[0];
            stats = {
                totalGames: row[0] || 0,
                wins: row[1] || 0,
                winRate: row[0] > 0 ? Math.round((row[1] / row[0]) * 100) : 0
            };
        }

        res.json({ success: true, games, stats });
    } catch (error) {
        console.error('获取游戏记录错误:', error);
        res.json({ success: false, message: '获取游戏记录失败' });
    }
});

io.use((socket, next) => {
    const sessionCookie = socket.handshake.headers.cookie;
    if (sessionCookie) {
        next();
    } else {
        next(new Error('未登录'));
    }
});

io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);

    socket.on('joinRoom', ({ userId, username, roomId, roomName, maxPlayers }) => {
        try {
            let room;
            let isNewRoom = false;

            if (!roomId) {
                roomId = generateRoomId();
                room = {
                    id: roomId,
                    name: roomName || `${username}的房间`,
                    hostId: userId,
                    maxPlayers: maxPlayers || 8,
                    players: [],
                    status: 'waiting',
                    gamePhase: 'waiting',
                    wordPair: null,
                    currentSpeakerIndex: 0,
                    votes: new Map(),
                    gameRecordId: null,
                    gameStartedAt: null,
                    disconnectedTimers: new Map()
                };
                rooms.set(roomId, room);
                isNewRoom = true;
                console.log('创建房间:', roomId);
            } else {
                room = rooms.get(roomId);
                if (!room) {
                    socket.emit('error', { message: '房间不存在' });
                    return;
                }
                
                const existingPlayerInRoom = room.players.find(p => p.userId === userId);
                if (!existingPlayerInRoom) {
                    if (room.players.length >= room.maxPlayers) {
                        socket.emit('error', { message: '房间已满' });
                        return;
                    }
                    if (room.status !== 'waiting') {
                        socket.emit('error', { message: '游戏已开始' });
                        return;
                    }
                }
            }

            const existingPlayer = room.players.find(p => p.userId === userId);
            let isReconnecting = false;
            
            if (existingPlayer) {
                existingPlayer.socketId = socket.id;
                existingPlayer.isReady = false;
                
                if (room.status === 'playing') {
                    if (room.disconnectedTimers.has(userId)) {
                        isReconnecting = true;
                        const timer = room.disconnectedTimers.get(userId);
                        clearTimeout(timer);
                        room.disconnectedTimers.delete(userId);
                        
                        existingPlayer.isDisconnected = false;
                        existingPlayer.disconnectedAt = null;
                        
                        console.log(`玩家 ${username} 重连成功，取消超时计时器`);
                    } else if (existingPlayer.isDisconnected) {
                        isReconnecting = true;
                        existingPlayer.isDisconnected = false;
                        existingPlayer.disconnectedAt = null;
                        console.log(`玩家 ${username} 重连成功（服务器重启后恢复）`);
                    }
                }
            } else {
                const player = {
                    userId,
                    username,
                    socketId: socket.id,
                    isReady: false,
                    isHost: userId === room.hostId,
                    role: null,
                    word: null,
                    isAlive: true,
                    hasSpoken: false,
                    isDisconnected: false,
                    disconnectedAt: null,
                    timeoutSeconds: 30
                };
                room.players.push(player);
            }

            socket.join(roomId);
            userSockets.set(userId, socket.id);

            saveRoomToDb(room);
            saveRoomPlayersToDb(room);

            const currentPlayer = room.players.find(p => p.userId === userId);
            
            if (room.status === 'playing' && existingPlayer && existingPlayer.word) {
                socket.emit('wordAssigned', {
                    word: existingPlayer.word,
                    role: existingPlayer.role,
                    category: room.wordPair?.category || '未知'
                });
                
                socket.emit('reconnected', {
                    phase: room.gamePhase,
                    players: room.players.map(p => ({
                        userId: p.userId,
                        username: p.username,
                        isAlive: p.isAlive,
                        hasSpoken: p.hasSpoken
                    }))
                });
            }

            if (isReconnecting) {
                io.to(roomId).emit('playerReconnected', {
                    userId: currentPlayer.userId,
                    username: currentPlayer.username,
                    message: `${currentPlayer.username} 已重新连接`
                });
            } else {
                io.to(roomId).emit('roomUpdate', {
                    roomId: room.id,
                    roomName: room.name,
                    hostId: room.hostId,
                    maxPlayers: room.maxPlayers,
                    players: room.players.map(p => ({
                        userId: p.userId,
                        username: p.username,
                        isReady: p.isReady,
                        isHost: p.isHost,
                        isAlive: p.isAlive
                    })),
                    status: room.status
                });
            }

            socket.emit('joinedRoom', { roomId, isHost: currentPlayer.isHost });
            console.log(`用户 ${username} 加入房间 ${roomId}${isReconnecting ? ' (重连)' : ''}`);
        } catch (error) {
            console.error('加入房间错误:', error);
            socket.emit('error', { message: '加入房间失败' });
        }
    });

    socket.on('ready', ({ userId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.players.find(p => p.userId === userId);
        if (player) {
            player.isReady = !player.isReady;
            
            saveRoomPlayersToDb(room);
            
            io.to(roomId).emit('roomUpdate', {
                roomId: room.id,
                roomName: room.name,
                hostId: room.hostId,
                maxPlayers: room.maxPlayers,
                players: room.players.map(p => ({
                    userId: p.userId,
                    username: p.username,
                    isReady: p.isReady,
                    isHost: p.isHost,
                    isAlive: p.isAlive
                })),
                status: room.status
            });
        }
    });

    socket.on('startGame', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const alivePlayers = room.players.filter(p => p.isAlive);
        if (alivePlayers.length < 4) {
            socket.emit('error', { message: '至少需要4人才能开始游戏' });
            return;
        }

        const allReady = alivePlayers.every(p => p.isReady || p.isHost);
        if (!allReady) {
            socket.emit('error', { message: '请等待所有玩家准备就绪' });
            return;
        }

        try {
            const db = getDb();
            db.run('INSERT INTO game_records (room_id, winner, duration) VALUES (?, ?, ?)', 
                [roomId, null, 0]);
            saveDatabase();
            
            const gameIdResult = db.exec('SELECT last_insert_rowid() as id');
            room.gameRecordId = gameIdResult[0].values[0][0];
        } catch (error) {
            console.error('创建游戏记录错误:', error);
        }

        room.status = 'playing';
        room.gamePhase = 'wordDistribution';
        room.gameStartedAt = Date.now();

        room.wordPair = getRandomWordPair();
        
        const alivePlayersList = room.players.filter(p => p.isAlive);
        const playerCount = alivePlayersList.length;
        const spyCount = playerCount >= 7 ? 2 : 1;
        
        const spyIndices = new Set();
        while (spyIndices.size < spyCount) {
            spyIndices.add(Math.floor(Math.random() * playerCount));
        }

        const db = getDb();
        const playerStmt = db.prepare('INSERT INTO game_players (game_record_id, user_id, role, word, is_alive) VALUES (?, ?, ?, ?, ?)');

        alivePlayersList.forEach((player, index) => {
            if (spyIndices.has(index)) {
                player.role = '卧底';
                player.word = room.wordPair.spy_word;
            } else {
                player.role = '平民';
                player.word = room.wordPair.normal_word;
            }
            player.hasSpoken = false;

            if (room.gameRecordId) {
                playerStmt.run([room.gameRecordId, player.userId, player.role, player.word, 1]);
            }

            const playerSocket = io.sockets.sockets.get(player.socketId);
            if (playerSocket) {
                playerSocket.emit('wordAssigned', {
                    word: player.word,
                    role: player.role,
                    category: room.wordPair.category
                });
            }
        });

        if (room.gameRecordId) {
            playerStmt.free();
        }

        saveRoomToDb(room);
        saveRoomPlayersToDb(room);
        saveDatabase();

        room.currentSpeakerIndex = 0;
        room.gamePhase = 'description';
        const currentSpeaker = alivePlayersList[room.currentSpeakerIndex];

        io.to(roomId).emit('gameStarted', {
            phase: 'description',
            currentSpeaker: {
                userId: currentSpeaker.userId,
                username: currentSpeaker.username
            },
            players: room.players.map(p => ({
                userId: p.userId,
                username: p.username,
                isAlive: p.isAlive,
                hasSpoken: p.hasSpoken
            }))
        });

        console.log(`房间 ${roomId} 游戏开始，开始时间: ${new Date(room.gameStartedAt).toLocaleString()}`);
    });

    socket.on('submitDescription', ({ roomId, userId, description }) => {
        const room = rooms.get(roomId);
        if (!room || room.gamePhase !== 'description') return;

        const alivePlayers = room.players.filter(p => p.isAlive);
        const currentPlayer = alivePlayers[room.currentSpeakerIndex];
        
        if (!currentPlayer || currentPlayer.userId !== userId) return;

        currentPlayer.hasSpoken = true;
        currentPlayer.description = description;

        io.to(roomId).emit('playerSpoke', {
            userId: currentPlayer.userId,
            username: currentPlayer.username,
            description: description
        });

        room.currentSpeakerIndex++;

        if (room.currentSpeakerIndex >= alivePlayers.length) {
            room.gamePhase = 'voting';
            room.votes = new Map();

            io.to(roomId).emit('votingPhase', {
                players: alivePlayers.map(p => ({
                    userId: p.userId,
                    username: p.username,
                    isAlive: p.isAlive
                }))
            });
        } else {
            const nextSpeaker = alivePlayers[room.currentSpeakerIndex];
            io.to(roomId).emit('nextSpeaker', {
                currentSpeaker: {
                    userId: nextSpeaker.userId,
                    username: nextSpeaker.username
                },
                players: room.players.map(p => ({
                    userId: p.userId,
                    username: p.username,
                    isAlive: p.isAlive,
                    hasSpoken: p.hasSpoken
                }))
            });
        }
    });

    socket.on('vote', ({ roomId, userId, targetUserId }) => {
        const room = rooms.get(roomId);
        if (!room || room.gamePhase !== 'voting') return;

        const alivePlayers = room.players.filter(p => p.isAlive);
        const voter = room.players.find(p => p.userId === userId);
        
        if (!voter || !voter.isAlive) return;
        if (room.votes.has(userId)) return;

        const target = room.players.find(p => p.userId === targetUserId);
        if (!target || !target.isAlive) return;

        room.votes.set(userId, targetUserId);

        io.to(roomId).emit('voteUpdate', {
            voterId: userId,
            voterName: voter.username,
            voted: true
        });

        if (room.votes.size >= alivePlayers.length) {
            processVotingResult(room, roomId);
        }
    });

    function processVotingResult(room, roomId) {
        const voteCount = new Map();
        
        room.votes.forEach((targetId) => {
            voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
        });

        let maxVotes = 0;
        let eliminatedUserIds = [];
        
        voteCount.forEach((count, userId) => {
            if (count > maxVotes) {
                maxVotes = count;
                eliminatedUserIds = [userId];
            } else if (count === maxVotes) {
                eliminatedUserIds.push(userId);
            }
        });

        let eliminatedPlayer = null;
        let isTie = eliminatedUserIds.length > 1;

        if (!isTie) {
            eliminatedPlayer = room.players.find(p => p.userId === parseInt(eliminatedUserIds[0]));
            if (eliminatedPlayer) {
                eliminatedPlayer.isAlive = false;
            }
        }

        const db = getDb();
        if (eliminatedPlayer && room.gameRecordId) {
            db.run('UPDATE game_players SET is_alive = 0 WHERE game_record_id = ? AND user_id = ?',
                [room.gameRecordId, eliminatedPlayer.userId]);
        }

        const alivePlayers = room.players.filter(p => p.isAlive);
        const spyPlayers = alivePlayers.filter(p => p.role === '卧底');
        const civilianPlayers = alivePlayers.filter(p => p.role === '平民');

        let gameOver = false;
        let winner = null;

        if (spyPlayers.length === 0) {
            gameOver = true;
            winner = '平民';
        } else if (spyPlayers.length >= civilianPlayers.length) {
            gameOver = true;
            winner = '卧底';
        }

        let duration = 0;
        if (gameOver && room.gameRecordId) {
            if (room.gameStartedAt) {
                duration = Math.round((Date.now() - room.gameStartedAt) / 1000);
            }
            db.run('UPDATE game_records SET winner = ?, duration = ? WHERE id = ?', 
                [winner, duration, room.gameRecordId]);
            
            room.status = 'finished';
            room.gamePhase = 'finished';
            deleteRoomFromDb(roomId);
            
            const durationMinutes = Math.floor(duration / 60);
            const durationSeconds = duration % 60;
            console.log(`房间 ${roomId} 游戏结束，获胜方: ${winner}，用时: ${durationMinutes}分${durationSeconds}秒`);
        } else {
            saveRoomPlayersToDb(room);
        }
        
        saveDatabase();

        io.to(roomId).emit('votingResult', {
            isTie,
            eliminatedPlayer: eliminatedPlayer ? {
                userId: eliminatedPlayer.userId,
                username: eliminatedPlayer.username,
                role: eliminatedPlayer.role
            } : null,
            voteCount: Object.fromEntries(voteCount),
            gameOver,
            winner,
            wordPair: room.wordPair,
            duration: duration
        });

        if (!gameOver) {
            room.gamePhase = 'description';
            room.currentSpeakerIndex = 0;
            room.votes = new Map();
            
            const newAlivePlayers = room.players.filter(p => p.isAlive);
            newAlivePlayers.forEach(p => p.hasSpoken = false);

            if (newAlivePlayers.length > 0) {
                const nextSpeaker = newAlivePlayers[0];
                io.to(roomId).emit('nextRound', {
                    phase: 'description',
                    currentSpeaker: {
                        userId: nextSpeaker.userId,
                        username: nextSpeaker.username
                    },
                    players: room.players.map(p => ({
                        userId: p.userId,
                        username: p.username,
                        isAlive: p.isAlive,
                        hasSpoken: p.hasSpoken
                    }))
                });
            }
        }
    }

    socket.on('leaveRoom', ({ userId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        room.players = room.players.filter(p => p.userId !== userId);
        socket.leave(roomId);
        userSockets.delete(userId);

        if (room.players.length === 0) {
            rooms.delete(roomId);
            deleteRoomFromDb(roomId);
            console.log('房间解散:', roomId);
        } else {
            if (room.hostId === userId) {
                room.hostId = room.players[0].userId;
                room.players[0].isHost = true;
            }

            saveRoomToDb(room);
            saveRoomPlayersToDb(room);

            io.to(roomId).emit('roomUpdate', {
                roomId: room.id,
                roomName: room.name,
                hostId: room.hostId,
                maxPlayers: room.maxPlayers,
                players: room.players.map(p => ({
                    userId: p.userId,
                    username: p.username,
                    isReady: p.isReady,
                    isHost: p.isHost,
                    isAlive: p.isAlive
                })),
                status: room.status
            });
        }

        console.log(`用户 ${userId} 离开房间 ${roomId}`);
    });

    socket.on('disconnect', () => {
        console.log('用户断开连接:', socket.id);
        
        rooms.forEach((room, roomId) => {
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                
                if (room.status === 'waiting') {
                    room.players.splice(playerIndex, 1);
                    
                    if (room.players.length === 0) {
                        rooms.delete(roomId);
                        deleteRoomFromDb(roomId);
                    } else {
                        if (room.hostId === player.userId) {
                            room.hostId = room.players[0].userId;
                            room.players[0].isHost = true;
                        }

                        saveRoomToDb(room);
                        saveRoomPlayersToDb(room);

                        io.to(roomId).emit('roomUpdate', {
                            roomId: room.id,
                            roomName: room.name,
                            hostId: room.hostId,
                            maxPlayers: room.maxPlayers,
                            players: room.players.map(p => ({
                                userId: p.userId,
                                username: p.username,
                                isReady: p.isReady,
                                isHost: p.isHost,
                                isAlive: p.isAlive
                            })),
                            status: room.status
                        });
                    }
                } else if (room.status === 'playing' && player.isAlive) {
                    console.log(`玩家 ${player.username} 在游戏中断线，房间: ${roomId}`);
                    
                    player.isDisconnected = true;
                    player.disconnectedAt = Date.now();
                    player.timeoutSeconds = 30;
                    
                    saveRoomPlayersToDb(room);
                    
                    io.to(roomId).emit('playerDisconnected', {
                        userId: player.userId,
                        username: player.username,
                        message: `${player.username} 断开连接，有30秒时间重连...`
                    });
                    
                    const timeout = 30 * 1000;
                    
                    const timer = setTimeout(() => {
                        console.log(`玩家 ${player.username} 超时未重连，自动淘汰`);
                        
                        player.isAlive = false;
                        player.isDisconnected = false;
                        player.disconnectedAt = null;
                        
                        const db = getDb();
                        if (room.gameRecordId) {
                            db.run('UPDATE game_players SET is_alive = 0 WHERE game_record_id = ? AND user_id = ?',
                                [room.gameRecordId, player.userId]);
                            saveDatabase();
                        }
                        
                        if (room.gamePhase === 'voting') {
                            console.log(`投票阶段断线超时，清理投票状态`);
                            room.votes.clear();
                            room.gamePhase = 'description';
                            room.currentSpeakerIndex = 0;
                            
                            const alivePlayers = room.players.filter(p => p.isAlive);
                            alivePlayers.forEach(p => p.hasSpoken = false);
                            
                            db.run('UPDATE room_players SET has_spoken = 0 WHERE room_id = (SELECT id FROM rooms WHERE room_code = ?)',
                                [roomId]);
                            
                            db.run(`UPDATE rooms SET game_phase = 'description', current_speaker_index = 0 WHERE room_code = ?`,
                                [roomId]);
                            
                            saveDatabase();
                            saveRoomPlayersToDb(room);
                            
                            io.to(roomId).emit('votingReset', {
                                message: '由于玩家断线超时，投票阶段已重置，请重新描述'
                            });
                        }
                        
                        const alivePlayers = room.players.filter(p => p.isAlive);
                        const spyPlayers = alivePlayers.filter(p => p.role === '卧底');
                        const civilianPlayers = alivePlayers.filter(p => p.role === '平民');
                        
                        let gameOver = false;
                        let winner = null;
                        
                        if (spyPlayers.length === 0) {
                            gameOver = true;
                            winner = '平民';
                        } else if (spyPlayers.length >= civilianPlayers.length) {
                            gameOver = true;
                            winner = '卧底';
                        }
                        
                        let duration = 0;
                        if (gameOver && room.gameRecordId) {
                            if (room.gameStartedAt) {
                                duration = Math.round((Date.now() - room.gameStartedAt) / 1000);
                            }
                            db.run('UPDATE game_records SET winner = ?, duration = ? WHERE id = ?', 
                                [winner, duration, room.gameRecordId]);
                            saveDatabase();
                            
                            room.status = 'finished';
                            room.gamePhase = 'finished';
                            deleteRoomFromDb(roomId);
                        }
                        
                        io.to(roomId).emit('playerTimeout', {
                            userId: player.userId,
                            username: player.username,
                            gameOver,
                            winner,
                            wordPair: room.wordPair,
                            duration: duration,
                            message: `${player.username} 超时未重连，已被淘汰`
                        });
                        
                        room.disconnectedTimers.delete(player.userId);
                        saveRoomPlayersToDb(room);
                        
                    }, timeout);
                    
                    room.disconnectedTimers.set(player.userId, timer);
                }
            }
        });
    });

    socket.on('chatMessage', ({ roomId, userId, username, message }) => {
        io.to(roomId).emit('chatMessage', {
            userId,
            username,
            message,
            timestamp: new Date().toLocaleTimeString()
        });
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

app.get('/game/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

async function startServer() {
    try {
        await initDatabase();
        console.log('数据库初始化完成');
        
        const restoredRooms = loadRoomsFromDb();
        restoredRooms.forEach((room, roomId) => {
            rooms.set(roomId, room);
            
            if (room.status === 'playing') {
                room.players.forEach(player => {
                    if (player.isDisconnected && player.isAlive && player.disconnectedAt) {
                        const elapsedMs = Date.now() - player.disconnectedAt;
                        const remainingMs = (player.timeoutSeconds * 1000) - elapsedMs;
                        
                        if (remainingMs > 0) {
                            console.log(`恢复断线计时器: ${player.username}, 剩余 ${Math.ceil(remainingMs/1000)} 秒`);
                            
                            const timer = setTimeout(() => {
                                handlePlayerTimeout(room, roomId, player);
                            }, remainingMs);
                            
                            room.disconnectedTimers.set(player.userId, timer);
                        } else {
                            console.log(`玩家 ${player.username} 断线超时，立即淘汰`);
                            handlePlayerTimeout(room, roomId, player);
                        }
                    }
                });
            }
        });
        
        server.listen(PORT, () => {
            console.log(`谁是卧底游戏服务器已启动: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('启动服务器失败:', error);
    }
}

function handlePlayerTimeout(room, roomId, player) {
    console.log(`玩家 ${player.username} 超时未重连，自动淘汰`);
    
    player.isAlive = false;
    player.isDisconnected = false;
    player.disconnectedAt = null;
    
    const db = getDb();
    if (room.gameRecordId) {
        db.run('UPDATE game_players SET is_alive = 0 WHERE game_record_id = ? AND user_id = ?',
            [room.gameRecordId, player.userId]);
        saveDatabase();
    }
    
    if (room.gamePhase === 'voting') {
        console.log(`投票阶段断线超时，清理投票状态`);
        room.votes.clear();
        room.gamePhase = 'description';
        room.currentSpeakerIndex = 0;
        
        const alivePlayers = room.players.filter(p => p.isAlive);
        alivePlayers.forEach(p => p.hasSpoken = false);
        
        db.run('UPDATE room_players SET has_spoken = 0 WHERE room_id = (SELECT id FROM rooms WHERE room_code = ?)',
            [roomId]);
        
        db.run(`UPDATE rooms SET game_phase = 'description', current_speaker_index = 0 WHERE room_code = ?`,
            [roomId]);
        
        saveDatabase();
        saveRoomPlayersToDb(room);
        
        io.to(roomId).emit('votingReset', {
            message: '由于玩家断线超时，投票阶段已重置，请重新描述'
        });
    }
    
    const alivePlayers = room.players.filter(p => p.isAlive);
    const spyPlayers = alivePlayers.filter(p => p.role === '卧底');
    const civilianPlayers = alivePlayers.filter(p => p.role === '平民');
    
    let gameOver = false;
    let winner = null;
    
    if (spyPlayers.length === 0) {
        gameOver = true;
        winner = '平民';
    } else if (spyPlayers.length >= civilianPlayers.length) {
        gameOver = true;
        winner = '卧底';
    }
    
    let duration = 0;
    if (gameOver && room.gameRecordId) {
        if (room.gameStartedAt) {
            duration = Math.round((Date.now() - room.gameStartedAt) / 1000);
        }
        db.run('UPDATE game_records SET winner = ?, duration = ? WHERE id = ?', 
            [winner, duration, room.gameRecordId]);
        saveDatabase();
        
        room.status = 'finished';
        room.gamePhase = 'finished';
        deleteRoomFromDb(roomId);
    }
    
    io.to(roomId).emit('playerTimeout', {
        userId: player.userId,
        username: player.username,
        gameOver,
        winner,
        wordPair: room.wordPair,
        duration: duration,
        message: `${player.username} 超时未重连，已被淘汰`
    });
    
    room.disconnectedTimers.delete(player.userId);
    saveRoomPlayersToDb(room);
}

startServer();
