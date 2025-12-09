const express = require('express');
const session = require('express-session');
const fs = require('fs').promises;
const path = require('path');
const commentSender = require('./commentSender');
const wiegine = require('ws3-fca');
const NgrokManager = require('./ngrokManager');

const app = express();
const PORT = 4000;
const ngrokManager = new NgrokManager('./ngrokconfig.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));
app.use(session({
  secret: 'vireobjectsyncedeal',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const DATA_DIR = path.join(__dirname, 'data');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const VALID_FILE = path.join(DATA_DIR, 'valid.json');
const EXPIRED_FILE = path.join(DATA_DIR, 'expired.json');
const USERDATA_DIR = path.join(__dirname, 'userdata');
const CMNTS_DIR = path.join(USERDATA_DIR);

const activeSessions = new Map();
const toolSessions = new Map(); 

function getPakistanTime() {
  const options = {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  return new Date().toLocaleString('en-PK', options);
}

async function readJSONSafe(filePath, defaultValue = {}) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return defaultValue;
  }
}

async function writeJSONSafe(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const jsonStr = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonStr, 'utf8');
    return true;
  } catch (e) {
    console.error('Error writing JSON:', e);
    return false;
  }
}

function getCookieKey(cookie) {
  const cleaned = typeof cookie === 'string' ? cookie : JSON.stringify(cookie);
  return cleaned.substring(0, 100).replace(/[^a-zA-Z0-9]/g, '_');
}

async function getAccountName(cookie, api = null) {
  const cookieKey = getCookieKey(cookie);
  
  const validData = await readJSONSafe(VALID_FILE, {});
  if (validData[cookieKey]) {
    return { name: validData[cookieKey].name, status: 'valid', cached: true };
  }
  
  const expiredData = await readJSONSafe(EXPIRED_FILE, {});
  if (expiredData[cookieKey]) {
    return { name: expiredData[cookieKey].name, status: 'expired', cached: true };
  }

  fetchAndCacheName(cookie, api);
  
  return { name: 'Fetching...', status: 'unknown', cached: false };
}

async function fetchAndCacheName(cookie, existingApi = null) {
  const cookieKey = getCookieKey(cookie);
  
  try {
    let api = existingApi;
    let needsLogin = !api;
    
    if (needsLogin) {
      api = await new Promise((resolve) => {
        wiegine.login(cookie, {}, (err, loginApi) => {
          if (err) resolve(null);
          else resolve(loginApi);
        });
      });
    }
    
    if (!api) {
      const expiredData = await readJSONSafe(EXPIRED_FILE, {});
      expiredData[cookieKey] = { cookie: cookieKey, name: 'Login Failed', timestamp: getPakistanTime() };
      await writeJSONSafe(EXPIRED_FILE, expiredData);
      return null;
    }
    
    const userInfo = await new Promise((resolve) => {
      api.getUserInfo(api.getCurrentUserID(), (err, info) => {
        if (err) resolve(null);
        else resolve(info);
      });
    });
    
    if (userInfo && userInfo[api.getCurrentUserID()]) {
      const name = userInfo[api.getCurrentUserID()].name || 'Unknown';
      const sanitizedName = name.replace(/['"{}]/g, ''); 
      
      const validData = await readJSONSafe(VALID_FILE, {});
      validData[cookieKey] = { cookie: cookieKey, name: sanitizedName, timestamp: getPakistanTime() };
      await writeJSONSafe(VALID_FILE, validData);
      
      return sanitizedName;
    } else {
      const expiredData = await readJSONSafe(EXPIRED_FILE, {});
      expiredData[cookieKey] = { cookie: cookieKey, name: 'Fetch Failed', timestamp: getPakistanTime() };
      await writeJSONSafe(EXPIRED_FILE, expiredData);
      return null;
    }
  } catch (e) {
    const expiredData = await readJSONSafe(EXPIRED_FILE, {});
    expiredData[cookieKey] = { cookie: cookieKey, name: 'Error', timestamp: getPakistanTime() };
    await writeJSONSafe(EXPIRED_FILE, expiredData);
    return null;
  }
}

async function initializeDirectories() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(USERDATA_DIR, { recursive: true });
    await fs.mkdir(path.join(__dirname, 'public'), { recursive: true });
    
    for (const file of [CREDENTIALS_FILE, VALID_FILE, EXPIRED_FILE, ADMIN_FILE]) {
      try {
        await fs.access(file);
      } catch {
        await writeJSONSafe(file, {});
      }
    }
  } catch (e) {
    console.error('Error initializing directories:', e);
  }
}

async function ensureUserDirectory(username) {
  const userDir = path.join(USERDATA_DIR, username);
  const chatsFile = path.join(userDir, 'chats.json');
  
  try {
    await fs.mkdir(userDir, { recursive: true });
    try {
      await fs.access(chatsFile);
    } catch {
      await writeJSONSafe(chatsFile, {});
    }
  } catch (e) {
    console.error('Error ensuring user directory:', e);
    throw e;
  }
}

async function readJSON(filePath, defaultValue = {}) {
  return readJSONSafe(filePath, defaultValue);
}

async function writeJSON(filePath, data) {
  return writeJSONSafe(filePath, data);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.username) {
    next();
  } else {
    res.redirect('/login');
  }
}

function requireAdminAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.redirect('/admin/login');
  }
}

app.get('/', (req, res) => {
  res.redirect('/information');
});

app.get('/information', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'information.html'));
});

app.get('/login', (req, res) => {
  if (req.session.username) res.redirect('/dashboard');
  else res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/msgsender', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'msgsender.html'));
});

app.get('/cookiechecker', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cookiechecker.html'));
});

app.get('/uidfetcher', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'uidfetcher.html'));
});

app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) res.redirect('/admin/control');
  else res.sendFile(path.join(__dirname, 'public', 'adminlogin.html'));
});

app.get('/admin/control', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admincontrol.html'));
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.json({ success: false, message: 'Username and password required' });
  }
  
  const credentials = await readJSON(CREDENTIALS_FILE);
  
  if (!credentials[username]) {
    return res.json({ success: false, message: 'Invalid username or password' });
  }
  
  if (credentials[username] !== password) {
    return res.json({ success: false, message: 'Invalid username or password' });
  }
  
  req.session.username = username;
  await ensureUserDirectory(username);
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.json({ success: false, message: 'Username and password required' });
  }
  
  const adminCredentials = await readJSON(ADMIN_FILE);
  
  if (!adminCredentials[username]) {
    return res.json({ success: false, message: 'Invalid admin credentials' });
  }
  
  if (adminCredentials[username] !== password) {
    return res.json({ success: false, message: 'Invalid admin credentials' });
  }
  
  req.session.isAdmin = true;
  req.session.adminUsername = username;
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
  const credentials = await readJSON(CREDENTIALS_FILE);
  res.json({ success: true, users: credentials });
});

app.post('/api/admin/users/create', requireAdminAuth, async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.json({ success: false, message: 'Username and password required' });
  }
  
  const sanitizedUsername = username.replace(/['"{}]/g, '').trim();
  const sanitizedPassword = password.replace(/['"{}]/g, '');
  
  if (!sanitizedUsername || !sanitizedPassword) {
    return res.json({ success: false, message: 'Invalid username or password format' });
  }
  
  const credentials = await readJSON(CREDENTIALS_FILE);
  
  if (credentials[sanitizedUsername]) {
    return res.json({ success: false, message: 'Username already exists' });
  }
  
  credentials[sanitizedUsername] = sanitizedPassword;
  await writeJSON(CREDENTIALS_FILE, credentials);
  
  await ensureUserDirectory(sanitizedUsername);
  
  res.json({ success: true, message: 'User created successfully' });
});

app.post('/api/admin/users/update', requireAdminAuth, async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.json({ success: false, message: 'Username and password required' });
  }
  
  const credentials = await readJSON(CREDENTIALS_FILE);
  
  if (!credentials[username]) {
    return res.json({ success: false, message: 'User not found' });
  }
  
  const sanitizedPassword = password.replace(/['"{}]/g, '');
  
  if (!sanitizedPassword) {
    return res.json({ success: false, message: 'Invalid password format' });
  }
  
  credentials[username] = sanitizedPassword;
  await writeJSON(CREDENTIALS_FILE, credentials);
  
  res.json({ success: true, message: 'Password updated successfully' });
});

app.post('/api/admin/users/delete', requireAdminAuth, async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.json({ success: false, message: 'Username required' });
  }
  
  const credentials = await readJSON(CREDENTIALS_FILE);
  
  if (!credentials[username]) {
    return res.json({ success: false, message: 'User not found' });
  }
  
  for (const [sessionKey, session] of activeSessions.entries()) {
  if (session.username === username) {
    if (sessionKey.includes('_cmnt_')) {
      const [, , postId] = sessionKey.split('_');
      await stopCommentPost(username, postId);
    } else {
      const [, chatId] = sessionKey.split('_');
      await stopChat(username, chatId);
    }
  }
}
  
  delete credentials[username];
  await writeJSON(CREDENTIALS_FILE, credentials);
  
  res.json({ success: true, message: 'User deleted successfully' });
});

app.post('/api/tools/check-cookies', requireAuth, async (req, res) => {
  const { cookies } = req.body;
  
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    return res.json({ success: false, message: 'No cookies provided' });
  }

  const sessionId = `cookie_check_${Date.now()}`;
  const results = [];

  try {
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i];
      let loginSuccess = false;
      let api = null;
      
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          api = await new Promise((resolve) => {
            wiegine.login(cookie, {}, (err, loginApi) => {
              if (err) resolve(null);
              else resolve(loginApi);
            });
          });

          if (api) {
            loginSuccess = true;
            break;
          }
          
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (loginSuccess && api) {
        let userInfo = null;
        
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            userInfo = await new Promise((resolve) => {
              api.getUserInfo(api.getCurrentUserID(), (err, info) => {
                if (err) resolve(null);
                else resolve(info);
              });
            });

            if (userInfo && userInfo[api.getCurrentUserID()]) {
              break;
            }
            
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
          } catch (e) {
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (userInfo && userInfo[api.getCurrentUserID()]) {
          const name = userInfo[api.getCurrentUserID()].name || 'Unknown';
          results.push({ cookie, name, valid: true });
          
          const cookieKey = getCookieKey(cookie);
          const validData = await readJSONSafe(VALID_FILE, {});
          validData[cookieKey] = { cookie: cookieKey, name, timestamp: getPakistanTime() };
          await writeJSONSafe(VALID_FILE, validData);
        } else {
          results.push({ cookie, name: 'Failed to get info', valid: false });
        }
      } else {
        results.push({ cookie, name: 'Login failed', valid: false });
      }
    }

    res.json({ success: true, results });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Tool APIs - UID Fetcher
app.post('/api/tools/fetch-threads', requireAuth, async (req, res) => {
  const { cookie, limit } = req.body;
  
  if (!cookie) {
    return res.json({ success: false, message: 'No cookie provided' });
  }

  const threadLimit = Math.min(Math.max(1, parseInt(limit) || 20), 100);
  let api = null;
  let loginSuccess = false;

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        api = await new Promise((resolve) => {
          wiegine.login(cookie, {}, (err, loginApi) => {
            if (err) resolve(null);
            else resolve(loginApi);
          });
        });

        if (api) {
          loginSuccess = true;
          break;
        }
        
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!loginSuccess || !api) {
      return res.json({ success: false, message: 'Failed to login after 3 attempts' });
    }

    let threads = [];
    
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        threads = await new Promise((resolve) => {
          api.getThreadList(threadLimit, null, [], (err, threadList) => {
            if (err) resolve([]);
            else resolve(threadList);
          });
        });

        if (threads && threads.length > 0) {
          break;
        }
        
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }

    const formattedThreads = threads.map(thread => ({
      name: thread.threadName || thread.name || 'Unnamed Thread',
      threadID: thread.threadID
    }));

    res.json({ success: true, threads: formattedThreads });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/cmntsender', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cmntsender.html'));
});
app.get('/api/cmnts', requireAuth, async (req, res) => {
  const username = req.session.username;
  await ensureUserDirectory(username);
  const cmntsFile = path.join(USERDATA_DIR, username, 'cmnts.json');
  const cmnts = await readJSON(cmntsFile, {});
  res.json(cmnts);
});

app.post('/api/cmnts/create', requireAuth, async (req, res) => {
  const username = req.session.username;
  await ensureUserDirectory(username);
  const cmntsFile = path.join(USERDATA_DIR, username, 'cmnts.json');
  const cmnts = await readJSON(cmntsFile, {});
  
  let postId = 1;
  while (cmnts[`post${postId}`]) postId++;
  
  const newPostId = `post${postId}`;
  cmnts[newPostId] = {
    cookies: [], postid: '', comments: [],
    short: '', timer: 40, running: false
  };
  
  await writeJSON(cmntsFile, cmnts);
  res.json({ success: true, postId: newPostId });
});

app.post('/api/cmnts/:postId/configure', requireAuth, async (req, res) => {
  const username = req.session.username;
  const { postId } = req.params;
  const { cookies, postid, comments, short, timer } = req.body;
  
  await ensureUserDirectory(username);
  const cmntsFile = path.join(USERDATA_DIR, username, 'cmnts.json');
  const cmnts = await readJSON(cmntsFile, {});
  
  if (!cmnts[postId]) return res.json({ success: false, message: 'Post not found' });
  
  cmnts[postId].cookies = Array.isArray(cookies) ? cookies : [];
  cmnts[postId].postid = postid || '';
  cmnts[postId].comments = Array.isArray(comments) ? comments : [];
  cmnts[postId].short = short || '';
  cmnts[postId].timer = Math.max(40, parseInt(timer) || 40);
  
  await writeJSON(cmntsFile, cmnts);
  res.json({ success: true });
});

app.delete('/api/cmnts/:postId', requireAuth, async (req, res) => {
  const username = req.session.username;
  const { postId } = req.params;
  
  if (activeSessions.has(`${username}_cmnt_${postId}`)) await stopCommentPost(username, postId);
  
  await ensureUserDirectory(username);
  const cmntsFile = path.join(USERDATA_DIR, username, 'cmnts.json');
  const cmnts = await readJSON(cmntsFile, {});
  delete cmnts[postId];
  await writeJSON(cmntsFile, cmnts);
  res.json({ success: true });
});

app.post('/api/cmnts/:postId/start', requireAuth, async (req, res) => {
  const result = await startCommentPost(req.session.username, req.params.postId);
  res.json(result);
});

app.post('/api/cmnts/:postId/stop', requireAuth, async (req, res) => {
  const result = await stopCommentPost(req.session.username, req.params.postId);
  res.json(result);
});

app.get('/api/cmnts/:postId/logs', requireAuth, async (req, res) => {
  const session = activeSessions.get(`${req.session.username}_cmnt_${req.params.postId}`);
  res.json({ logs: session?.logs || [] });
});
app.get('/api/chats', requireAuth, async (req, res) => {
  const username = req.session.username;
  await ensureUserDirectory(username);
  const chatsFile = path.join(USERDATA_DIR, username, 'chats.json');
  const chats = await readJSON(chatsFile, {});
  res.json(chats);
});

app.post('/api/chats/create', requireAuth, async (req, res) => {
  const username = req.session.username;
  await ensureUserDirectory(username);
  const chatsFile = path.join(USERDATA_DIR, username, 'chats.json');
  const chats = await readJSON(chatsFile, {});
  
  let chatId = 1;
  while (chats[`chat${chatId}`]) chatId++;
  
  const newChatId = `chat${chatId}`;
  chats[newChatId] = {
    cookies: [], targetid: '', messages: [],
    short: '', timer: 40, running: false
  };
  
  await writeJSON(chatsFile, chats);
  res.json({ success: true, chatId: newChatId });
});

app.post('/api/chats/:chatId/configure', requireAuth, async (req, res) => {
  const username = req.session.username;
  const { chatId } = req.params;
  const { cookies, targetid, messages, short, timer } = req.body;
  
  await ensureUserDirectory(username);
  const chatsFile = path.join(USERDATA_DIR, username, 'chats.json');
  const chats = await readJSON(chatsFile, {});
  
  if (!chats[chatId]) return res.json({ success: false, message: 'Chat not found' });
  
  chats[chatId].cookies = Array.isArray(cookies) ? cookies : [];
  chats[chatId].targetid = targetid 
