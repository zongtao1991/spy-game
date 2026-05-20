const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'spy-game.db');

let db = null;

async function initDatabase() {
    const SQL = await initSqlJs();
    
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('数据库已加载');
    } else {
        db = new SQL.Database();
        console.log('创建新数据库');
        createTables();
        insertDefaultData();
        saveDatabase();
    }
    return db;
}

function createTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS word_pairs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            normal_word TEXT NOT NULL,
            spy_word TEXT NOT NULL,
            category TEXT DEFAULT '通用',
            UNIQUE(normal_word, spy_word)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            host_id INTEGER,
            max_players INTEGER DEFAULT 8,
            status TEXT DEFAULT 'waiting',
            game_phase TEXT DEFAULT 'waiting',
            word_pair_id INTEGER,
            current_speaker_index INTEGER DEFAULT 0,
            game_record_id INTEGER,
            game_started_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (host_id) REFERENCES users(id),
            FOREIGN KEY (word_pair_id) REFERENCES word_pairs(id),
            FOREIGN KEY (game_record_id) REFERENCES game_records(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS room_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            is_ready INTEGER DEFAULT 0,
            is_host INTEGER DEFAULT 0,
            role TEXT,
            word TEXT,
            is_alive INTEGER DEFAULT 1,
            has_spoken INTEGER DEFAULT 0,
            is_disconnected INTEGER DEFAULT 0,
            disconnected_at INTEGER,
            timeout_seconds INTEGER DEFAULT 30,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES rooms(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(room_id, user_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS game_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id INTEGER,
            winner TEXT,
            duration INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (room_id) REFERENCES rooms(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS game_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_record_id INTEGER,
            user_id INTEGER,
            role TEXT,
            word TEXT,
            is_alive INTEGER DEFAULT 1,
            FOREIGN KEY (game_record_id) REFERENCES game_records(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    console.log('数据表创建完成');
}

function insertDefaultData() {
    const wordPairs = [
        ['饺子', '包子', '食物'],
        ['端午节', '中秋节', '节日'],
        ['赵敏', '黄蓉', '人物'],
        ['婚纱', '喜服', '服饰'],
        ['汉堡包', '肉夹馍', '食物'],
        ['情人节', '光棍节', '节日'],
        ['薰衣草', '满天星', '植物'],
        ['图书馆', '书店', '场所'],
        ['方便面', '挂面', '食物'],
        ['北京', '南京', '城市'],
        ['班主任', '辅导员', '职业'],
        ['作家', '编剧', '职业'],
        ['警察', '捕快', '职业'],
        ['公交', '地铁', '交通'],
        ['甄嬛传', '如懿传', '影视'],
        ['葡萄', '提子', '水果'],
        ['猫', '狗', '动物'],
        ['高跟鞋', '增高鞋', '服饰'],
        ['牛奶', '豆浆', '饮品'],
        ['土豆', '地瓜', '蔬菜'],
        ['iphone', 'ipad', '数码'],
        ['电风扇', '空调', '家电'],
        ['电影', '电视剧', '影视'],
        ['耳机', '音响', '数码'],
        ['土豆粉', '酸辣粉', '食物'],
        ['双胞胎', '龙凤胎', '人物'],
        ['网吧', '网咖', '场所'],
        ['魔术师', '魔法师', '职业'],
        ['状元', '冠军', '荣誉'],
        ['眉毛', '胡须', '人体'],
        ['端午节', '重阳节', '节日'],
        ['白马王子', '黑马王子', '人物'],
        ['新年', '跨年', '节日'],
        ['吉它', '琵琶', '乐器'],
        ['豆浆', '牛奶', '饮品'],
        ['保安', '保镖', '职业'],
        ['白菜', '生菜', '蔬菜'],
        ['辣椒', '芥末', '调料'],
        ['金庸', '古龙', '人物'],
        ['海豚', '海狮', '动物'],
        ['水盆', '水桶', '日用品'],
        ['唇膏', '口红', '化妆品'],
        ['烤肉', '涮肉', '食物'],
        ['气泡', '水泡', '自然'],
        ['儿童节', '父亲节', '节日'],
        ['丑小鸭', '灰姑娘', '童话'],
        ['公交车', '地铁', '交通'],
        ['洗衣粉', '肥皂', '日用品'],
        ['何炅', '维嘉', '人物'],
        ['钢琴', '小提琴', '乐器'],
        ['书包', '背包', '日用品'],
        ['橡皮擦', '修正带', '文具'],
        ['钢笔', '圆珠笔', '文具'],
        ['镜子', '玻璃', '日用品'],
        ['桌子', '椅子', '家具'],
        ['笔记本', '作业本', '文具'],
        ['课本', '练习册', '书籍'],
        ['电脑', '平板', '数码'],
        ['鼠标', '键盘', '数码配件'],
        ['水杯', '水壶', '日用品'],
        ['眼镜', '墨镜', '配饰'],
        ['手表', '闹钟', '计时'],
        ['雨伞', '雨衣', '雨具'],
        ['鞋子', '靴子', '服饰'],
        ['帽子', '围巾', '服饰'],
        ['手套', '袜子', '服饰'],
        ['游泳', '潜水', '运动'],
        ['篮球', '足球', '运动'],
        ['网球', '羽毛球', '运动'],
        ['跑步', '散步', '运动'],
        ['春天', '夏天', '季节'],
        ['秋天', '冬天', '季节'],
        ['早餐', '午餐', '餐饮'],
        ['晚餐', '夜宵', '餐饮'],
        ['咖啡', '茶', '饮品'],
        ['面包', '蛋糕', '食物'],
        ['米饭', '面条', '主食'],
        ['牛肉', '猪肉', '肉类'],
        ['鸡肉', '鸭肉', '肉类'],
        ['苹果', '香蕉', '水果'],
        ['西瓜', '草莓', '水果'],
        ['洋葱', '大蒜', '调料'],
        ['番茄', '茄子', '蔬菜'],
        ['玉米', '红薯', '杂粮'],
        ['豆浆', '豆腐', '豆制品'],
        ['酱油', '醋', '调料'],
        ['盐', '糖', '调料'],
        ['冰箱', '洗衣机', '家电'],
        ['电视', '投影仪', '家电'],
        ['微波炉', '烤箱', '厨房电器'],
        ['碗', '盘子', '餐具'],
        ['筷子', '勺子', '餐具'],
        ['毛巾', '浴巾', '日用品'],
        ['牙刷', '牙膏', '日用品'],
        ['洗发水', '沐浴露', '洗护用品'],
        ['护肤品', '化妆品', '美妆']
    ];

    const seen = new Set();
    const uniquePairs = [];
    
    for (const pair of wordPairs) {
        const key1 = `${pair[0]}|${pair[1]}`;
        const key2 = `${pair[1]}|${pair[0]}`;
        if (!seen.has(key1) && !seen.has(key2)) {
            seen.add(key1);
            uniquePairs.push(pair);
        }
    }

    const stmt = db.prepare('INSERT OR IGNORE INTO word_pairs (normal_word, spy_word, category) VALUES (?, ?, ?)');
    for (const pair of uniquePairs) {
        stmt.run(pair);
    }
    stmt.free();

    console.log('默认词语对处理完成，去重后共', uniquePairs.length, '条');
}

function insertWordPair(normalWord, spyWord, category = '通用') {
    const db = getDb();
    const checkResult = db.exec(
        'SELECT id FROM word_pairs WHERE (normal_word = ? AND spy_word = ?) OR (normal_word = ? AND spy_word = ?)',
        [normalWord, spyWord, spyWord, normalWord]
    );
    
    if (checkResult.length > 0 && checkResult[0].values.length > 0) {
        console.log('词语对已存在:', normalWord, '-', spyWord, '或反序');
        return { success: false, message: '词语对已存在' };
    }

    db.run(
        'INSERT INTO word_pairs (normal_word, spy_word, category) VALUES (?, ?, ?)',
        [normalWord, spyWord, category]
    );
    saveDatabase();
    
    const idResult = db.exec('SELECT last_insert_rowid() as id');
    const id = idResult[0].values[0][0];
    
    console.log('新增词语对:', id, normalWord, '-', spyWord);
    return { success: true, id };
}

function saveDatabase() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

function getDb() {
    if (!db) {
        throw new Error('数据库未初始化');
    }
    return db;
}

function saveRoomToDb(room) {
    const db = getDb();
    
    const checkResult = db.exec('SELECT id FROM rooms WHERE room_code = ?', [room.id]);
    
    if (checkResult.length > 0 && checkResult[0].values.length > 0) {
        db.run(`
            UPDATE rooms SET 
                name = ?, host_id = ?, max_players = ?, status = ?, 
                game_phase = ?, word_pair_id = ?, current_speaker_index = ?, 
                game_record_id = ?, game_started_at = ?
            WHERE room_code = ?
        `, [
            room.name, room.hostId, room.maxPlayers, room.status,
            room.gamePhase, room.wordPair?.id || null, room.currentSpeakerIndex,
            room.gameRecordId, room.gameStartedAt || null,
            room.id
        ]);
    } else {
        db.run(`
            INSERT INTO rooms (room_code, name, host_id, max_players, status, 
                game_phase, word_pair_id, current_speaker_index, game_record_id, game_started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            room.id, room.name, room.hostId, room.maxPlayers, room.status,
            room.gamePhase, room.wordPair?.id || null, room.currentSpeakerIndex,
            room.gameRecordId, room.gameStartedAt || null
        ]);
    }
    
    saveDatabase();
}

function saveRoomPlayersToDb(room) {
    const db = getDb();
    
    const roomResult = db.exec('SELECT id FROM rooms WHERE room_code = ?', [room.id]);
    if (roomResult.length === 0 || roomResult[0].values.length === 0) return;
    
    const roomDbId = roomResult[0].values[0][0];
    
    db.run('DELETE FROM room_players WHERE room_id = ?', [roomDbId]);
    
    const stmt = db.prepare(`
        INSERT INTO room_players (room_id, user_id, username, is_ready, is_host, role, word, is_alive, has_spoken, is_disconnected, disconnected_at, timeout_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const player of room.players) {
        stmt.run([
            roomDbId, player.userId, player.username,
            player.isReady ? 1 : 0, player.isHost ? 1 : 0,
            player.role, player.word, player.isAlive ? 1 : 0, player.hasSpoken ? 1 : 0,
            player.isDisconnected ? 1 : 0, player.disconnectedAt, player.timeoutSeconds
        ]);
    }
    
    stmt.free();
    saveDatabase();
}

function loadRoomsFromDb() {
    const db = getDb();
    const rooms = new Map();
    
    const result = db.exec(`
        SELECT r.id, r.room_code, r.name, r.host_id, r.max_players, r.status, 
               r.game_phase, r.word_pair_id, r.current_speaker_index, 
               r.game_record_id, r.game_started_at, r.created_at,
               wp.normal_word, wp.spy_word, wp.category
        FROM rooms r
        LEFT JOIN word_pairs wp ON r.word_pair_id = wp.id
        WHERE r.status != 'finished'
    `);
    
    if (result.length > 0) {
        for (const row of result[0].values) {
            const roomCode = row[1];
            let gamePhase = row[6];
            let currentSpeakerIndex = row[8] || 0;
            
            if (gamePhase === 'voting') {
                console.log(`房间 ${roomCode} 处于投票阶段，重置为描述阶段`);
                gamePhase = 'description';
                currentSpeakerIndex = 0;
                
                db.run(`
                    UPDATE rooms SET game_phase = 'description', current_speaker_index = 0
                    WHERE room_code = ?
                `, [roomCode]);
                
                db.run(`
                    UPDATE room_players SET has_spoken = 0
                    WHERE room_id = (SELECT id FROM rooms WHERE room_code = ?)
                `, [roomCode]);
            }
            
            const room = {
                id: roomCode,
                name: row[2],
                hostId: row[3],
                maxPlayers: row[4],
                status: row[5],
                gamePhase: gamePhase,
                wordPair: row[7] ? {
                    id: row[7],
                    normal_word: row[12],
                    spy_word: row[13],
                    category: row[14]
                } : null,
                currentSpeakerIndex: currentSpeakerIndex,
                gameRecordId: row[9],
                gameStartedAt: row[10],
                players: [],
                votes: new Map(),
                disconnectedTimers: new Map()
            };
            
            const playersResult = db.exec(`
                SELECT user_id, username, is_ready, is_host, role, word, is_alive, has_spoken, is_disconnected, disconnected_at, timeout_seconds
                FROM room_players WHERE room_id = ?
            `, [row[0]]);
            
            if (playersResult.length > 0) {
                for (const playerRow of playersResult[0].values) {
                    room.players.push({
                        userId: playerRow[0],
                        username: playerRow[1],
                        socketId: null,
                        isReady: playerRow[2] === 1,
                        isHost: playerRow[3] === 1,
                        role: playerRow[4],
                        word: playerRow[5],
                        isAlive: playerRow[6] === 1,
                        hasSpoken: gamePhase === 'voting' ? false : (playerRow[7] === 1),
                        isDisconnected: playerRow[8] === 1,
                        disconnectedAt: playerRow[9],
                        timeoutSeconds: playerRow[10] || 30
                    });
                }
            }
            
            rooms.set(roomCode, room);
        }
        
        saveDatabase();
    }
    
    console.log('从数据库恢复房间:', rooms.size, '个');
    return rooms;
}

function deleteRoomFromDb(roomCode) {
    const db = getDb();
    
    const roomResult = db.exec('SELECT id FROM rooms WHERE room_code = ?', [roomCode]);
    if (roomResult.length > 0 && roomResult[0].values.length > 0) {
        const roomDbId = roomResult[0].values[0][0];
        db.run('DELETE FROM room_players WHERE room_id = ?', [roomDbId]);
    }
    
    db.run('DELETE FROM rooms WHERE room_code = ?', [roomCode]);
    saveDatabase();
}

module.exports = {
    initDatabase,
    getDb,
    saveDatabase,
    insertWordPair,
    saveRoomToDb,
    saveRoomPlayersToDb,
    loadRoomsFromDb,
    deleteRoomFromDb
};
