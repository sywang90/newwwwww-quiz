const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');

// 托管静态资源
app.use(express.static(__dirname));

// 根路由指向
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'index.html')); 
});

const TEAMS = ["中区", "东区", "西南区", "北二区", "南区", "北一区", "西北区"];
let users = new Map(); // key: socket.id, value: { name, team }
let activeTeams = []; // 当前生效的大区
let quizStarted = false;
let hasWinner = false;
let isLocking = false; // 🔒 200人高并发原子安全锁

function getTeamCounts() {
    const counts = {};
    TEAMS.forEach(team => {
        counts[team] = 0;
    });
    for (const user of users.values()) {
        if (user && user.team && counts.hasOwnProperty(user.team)) {
            counts[user.team]++;
        }
    }
    return counts;
}

function broadcastStatus() {
    const userNames = Array.from(users.values()).map(user => user.name);
    io.emit('updateUserList', userNames);
    io.emit('teamCountsUpdated', getTeamCounts());
    io.emit('activeTeamsUpdated', activeTeams);
}

io.on('connection', (socket) => {
    // 同步给新连入的设备（如大屏幕）最新的在线名单、大区状态、人数统计
    socket.emit('updateUserList', Array.from(users.values()).map(user => user.name));
    socket.emit('activeTeamsUpdated', activeTeams);
    socket.emit('teamCountsUpdated', getTeamCounts());

    socket.on('register', (team) => {
        const cleanTeam = (team || "").trim();
        if (!TEAMS.includes(cleanTeam)) {
            socket.emit('registerRejected', '无效的大区');
            return;
        }
        if (!activeTeams.includes(cleanTeam)) {
            socket.emit('registerRejected', '大区未开启');
            return;
        }
        
        // 计算当前大区已加入人数
        let count = 0;
        for (const user of users.values()) {
            if (user.team === cleanTeam) {
                count++;
            }
        }
        const name = `【${cleanTeam}】${count + 1}号`;
        
        users.set(socket.id, { name, team: cleanTeam });
        socket.emit('registered', name);
        broadcastStatus();
    });

    socket.on('startQuiz', () => {
        quizStarted = true;
        hasWinner = false;
        isLocking = false; 
        io.emit('quizStarted'); 
    });

    socket.on('pressButton', (clientName) => {
        const user = users.get(socket.id);
        if (!user || !user.team || !activeTeams.includes(user.team)) {
            socket.emit('invalidPress');
            return;
        }
        if (!quizStarted || hasWinner || isLocking) {
            socket.emit('invalidPress');
            return;
        }
        
        isLocking = true; // 瞬间落锁
        hasWinner = true;
        quizStarted = false; 
        
        const finalWinnerName = user.name;
        io.emit('quizEnd', finalWinnerName);
    });

    socket.on('luckyDraw', () => {
        if (users.size === 0) return;
        const userArray = Array.from(users.values());
        const luckyUser = userArray[Math.floor(Math.random() * userArray.length)];
        io.emit('drawResult', luckyUser.name);
    });

    socket.on('updateActiveTeams', (teams) => {
        if (Array.isArray(teams)) {
            activeTeams = teams.filter(t => TEAMS.includes(t));
            io.emit('activeTeamsUpdated', activeTeams);
            broadcastStatus();
        }
    });

    socket.on('disconnect', () => {
        if (users.has(socket.id)) {
            users.delete(socket.id);
            broadcastStatus();
        }
    });
});

// 🚀 Render云端必须的动态端口自适应，并强制监听 0.0.0.0
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`🎉 MCE 大力神杯系统已成功启动，正在监听端口: ${PORT}`);
});