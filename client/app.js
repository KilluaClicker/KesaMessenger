javascript
const $ = id => document.getElementById(id);

const SERVER = (
    window.KESA_SERVER_URL ||
    'https://kesa-messenger.onrender.com'
).replace(/\/+$/, '');

let token = localStorage.getItem('kesa_token') || '';
let mode = 'login';
let activeChat = null;
let chats = [];
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentUser = null;
let authRequestInProgress = false;
let authCheckInProgress = false;

async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };

    if (token) {
        headers.Authorization = 'Bearer ' + token;
    }

    if (opts.body && !(opts.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    let response;

    try {
        response = await fetch(SERVER + path, {
            ...opts,
            headers
        });
    } catch (error) {
        throw new Error(
            'Не удалось подключиться к серверу. Проверь интернет.'
        );
    }

    let data;

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (response.status === 401) {
        const isAuthRoute = path.startsWith('/api/auth/');

        if (!isAuthRoute) {
            throw new Error(
                data.error || 'Сессия недействительна. Войди в аккаунт заново.'
            );
        }
    }

    if (!response.ok) {
        throw new Error(
            data.error || `Ошибка сервера (${response.status})`
        );
    }

    return data;
}

function saveToken(value) {
    token = value;
    localStorage.setItem('kesa_token', value);
}

function clearSession() {
    token = '';
    currentUser = null;
    activeChat = null;
    chats = [];

    localStorage.removeItem('kesa_token');

    if ($('chatList')) $('chatList').innerHTML = '';
    if ($('messages')) $('messages').innerHTML = '';

    showAuth();
}

function showAuth() {
    $('auth').classList.remove('hidden');
    $('app').classList.add('hidden');
}

function showApp(user) {
    currentUser = user;
    window.currentUserId = user.id;

    $('auth').classList.add('hidden');
    $('app').classList.remove('hidden');

    $('myName').textContent = user.username || 'Пользователь';
    $('myAvatar').textContent =
        (user.username || '?')[0].toUpperCase();

    loadChats();
}

function setMode(newMode) {
    mode = newMode;

    $('loginTab').classList.toggle('active', mode === 'login');
    $('registerTab').classList.toggle('active', mode === 'register');

    $('authSubmit').innerHTML =
        mode === 'login'
            ? 'Войти в KESA <span>↗</span>'
            : 'Создать аккаунт <span>↗</span>';

    $('password').autocomplete =
        mode === 'login' ? 'current-password' : 'new-password';

    $('authError').textContent = '';
}

$('loginTab').onclick = () => setMode('login');
$('registerTab').onclick = () => setMode('register');

$('authForm').onsubmit = async event => {
    event.preventDefault();

    if (authRequestInProgress) return;
    authRequestInProgress = true;

    $('authSubmit').disabled = true;
    $('authError').textContent = '';

    try {
        const data = await api('/api/auth/' + mode, {
            method: 'POST',
            body: JSON.stringify({
                username: $('username').value.trim(),
                password: $('password').value
            })
        });

        if (!data.token || !data.user) {
            throw new Error(
                'Сервер не вернул токен или данные пользователя.'
            );
        }

        saveToken(data.token);
        showApp(data.user);
        $('password').value = '';
    } catch (error) {
        $('authError').textContent = error.message;
    } finally {
        $('authSubmit').disabled = false;
        authRequestInProgress = false;
    }
};

async function restoreSession() {
    if (authCheckInProgress) return;
    authCheckInProgress = true;

    try {
        const savedToken = localStorage.getItem('kesa_token');

        if (!savedToken) {
            showAuth();
            return;
        }

        token = savedToken;

        const data = await api('/api/me');

        if (!data.user) {
            throw new Error('Сервер не вернул профиль пользователя.');
        }

        showApp(data.user);
    } catch (error) {
        // Не удаляем токен при сетевой ошибке или временной
        // недоступности Render: попробуем восстановить сессию позже.
        if (
            /Сессия недействительна|Войдите в аккаунт заново|токен|авторизац/i
                .test(error.message)
        ) {
            clearSession();
        } else {
            showAuth();
            $('authError').textContent =
                'Не удалось восстановить сессию. Проверь подключение и повтори попытку.';
        }
    } finally {
        authCheckInProgress = false;
    }
}

async function loadChats() {
    if (!token || !currentUser) return;

    try {
        const data = await api('/api/chats');

        chats = data.chats || [];
        renderChats();

        $('connection').textContent = '● Сервер подключён';
        $('connection').style.color = '#48e3a4';
    } catch (error) {
        $('connection').textContent = '● Нет соединения';
        $('connection').style.color = '#ff8197';
        console.error('Ошибка загрузки чатов:', error.message);
    }
}

function renderChats() {
    $('chatList').innerHTML = '';

    chats.forEach(chat => {
        const element = document.createElement('div');

        element.className =
            'chat-item' +
            (activeChat && activeChat.id === chat.id ? ' active' : '');

        element.innerHTML =
            '<div class="avatar"></div>' +
            '<div class="chat-meta"><b></b><small></small></div>';

        element.querySelector('.avatar').textContent =
            (chat.title || '?')[0].toUpperCase();

        element.querySelector('b').textContent =
            chat.title || 'Чат';

        element.querySelector('small').textContent =
            chat.type === 'group'
                ? 'Групповая беседа'
                : 'Личные сообщения';

        element.onclick = () => openChat(chat);

        $('chatList').append(element);
    });
}

async function openChat(chat) {
    activeChat = chat;

    $('welcome').classList.add('hidden');
    $('messages').classList.remove('hidden');
    $('composer').classList.remove('hidden');

    $('chatTitle').textContent = chat.title || 'Чат';

    $('viewEyebrow').textContent =
        chat.type === 'group'
            ? 'ГРУППОВОЙ ЧАТ'
            : 'ЛИЧНЫЕ СООБЩЕНИЯ';

    renderChats();
    await loadMessages();
}

async function loadMessages() {
    if (!activeChat || !token) return;

    try {
        const data = await api(
            '/api/chats/' +
            encodeURIComponent(activeChat.id) +
            '/messages'
        );

        $('messages').innerHTML = '';

        (data.messages || []).forEach(renderMessage);

        $('messages').scrollTop = $('messages').scrollHeight;
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error.message);
    }
}

function renderMessage(message) {
    const mine =
        currentUser &&
        String(message.sender_id) === String(currentUser.id);

    const element = document.createElement('div');
    element.className = 'message' + (mine ? ' mine' : '');

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = (message.username || '?')[0].toUpperCase();

    const body = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const head = document.createElement('div');
    head.className = 'msg-head';
    head.textContent = message.username || 'Пользователь';

    bubble.append(head);

    if (message.kind === 'voice') {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = SERVER + message.file_url;
        audio.preload = 'none';
        bubble.append(audio);
    } else if (message.kind === 'file') {
        const link = document.createElement('a');
        link.href = SERVER + message.file_url;
        link.textContent = '↥ ' + (message.file_name || 'Файл');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        bubble.append(link);
    } else {
        const text = document.createElement('div');
        text.textContent = message.content || '';
        bubble.append(text);
    }

    const time = document.createElement('div');
    time.className = 'msg-time';

    time.textContent = message.created_at
        ? new Date(message.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        })
        : '';

    body.append(bubble, time);
    element.append(avatar, body);
    $('messages').append(element);
}

async function sendMessage(content, kind = 'text', extra = {}) {
    if (!activeChat) {
        throw new Error('Сначала открой чат.');
    }

    await api(
        '/api/chats/' +
        encodeURIComponent(activeChat.id) +
        '/messages',
        {
            method: 'POST',
            body: JSON.stringify({ content, kind, ...extra })
        }
    );

    await loadMessages();
}

$('composer').onsubmit = async event => {
    event.preventDefault();

    const message = $('messageInput').value.trim();
    if (!message) return;

    try {
        await sendMessage(message);
        $('messageInput').value = '';
    } catch (error) {
        toast(error.message);
    }
};

$('messageInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        $('composer').requestSubmit();
    }
});

$('fileInput').onchange = async event => {
    const file = event.target.files[0];

    if (!file || !activeChat) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
        await api(
            '/api/chats/' +
            encodeURIComponent(activeChat.id) +
            '/upload',
            {
                method: 'POST',
                body: formData
            }
        );

        await loadMessages();
    } catch (error) {
        toast(error.message);
    } finally {
        event.target.value = '';
    }
};

$('recordBtn').onclick = async () => {
    if (isRecording) {
        finishRecording(true);
        return;
    }

    if (!activeChat) {
        toast('Сначала открой чат.');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = event => {
            if (event.data.size) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());

            if (audioChunks.length && isRecording && activeChat) {
                const blob = new Blob(audioChunks, {
                    type: mediaRecorder.mimeType || 'audio/webm'
                });

                const formData = new FormData();
                formData.append('file', blob, 'voice.webm');

                try {
                    await api(
                        '/api/chats/' +
                        encodeURIComponent(activeChat.id) +
                        '/upload?kind=voice',
                        {
                            method: 'POST',
                            body: formData
                        }
                    );

                    await loadMessages();
                } catch (error) {
                    toast(error.message);
                }
            }

            isRecording = false;
            $('recording').classList.add('hidden');
            $('recordBtn').textContent = '♫';
        };

        mediaRecorder.start();
        isRecording = true;

        $('recording').classList.remove('hidden');
        $('recordBtn').textContent = '●';
    } catch (error) {
        toast('Не удалось включить микрофон. Проверь разрешения приложения.');
    }
};

function finishRecording(send) {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    if (!send) isRecording = false;

    mediaRecorder.stop();
}

$('stopRecord').onclick = () => finishRecording(true);
$('cancelRecord').onclick = () => finishRecording(false);

$('logout').onclick = () => {
    clearSession();
};

$('refresh').onclick = () => {
    loadChats();
    loadMessages();
};

let modalMode = 'dm';

function openModal(type) {
    modalMode = type;

    $('modalTitle').textContent =
        type === 'group' ? 'Создать группу' : 'Новый диалог';

    $('modalLabel').textContent =
        type === 'group' ? 'Название группы' : 'Имя пользователя';

    $('modalInput').placeholder =
        type === 'group'
            ? 'Например, Друзья'
            : 'Точное имя пользователя';

    $('modalError').textContent = '';
    $('modal').classList.remove('hidden');
    $('modalInput').focus();
}

$('newGroup').onclick = () => openModal('group');

document.querySelector('[data-view="groups"]').onclick =
    () => openModal('group');

document.querySelector('[data-view="direct"]').onclick = () => {
    if (activeChat) {
        openChat(activeChat);
    } else {
        openModal('dm');
    }
};

$('closeModal').onclick = () =>
    $('modal').classList.add('hidden');

$('modal').onclick = event => {
    if (event.target === $('modal')) {
        $('modal').classList.add('hidden');
    }
};

$('modalForm').onsubmit = async event => {
    event.preventDefault();

    const value = $('modalInput').value.trim();

    if (!value) {
        $('modalError').textContent = 'Заполни это поле.';
        return;
    }

    try {
        const data = await api(
            modalMode === 'group'
                ? '/api/chats/group'
                : '/api/chats/direct',
            {
                method: 'POST',
                body: JSON.stringify(
                    modalMode === 'group'
                        ? { title: value }
                        : { username: value }
                )
            }
        );

        $('modal').classList.add('hidden');

        await loadChats();

        const chat =
            chats.find(item =>
                data.chat && String(item.id) === String(data.chat.id)
            ) || data.chat;

        if (chat) await openChat(chat);
    } catch (error) {
        $('modalError').textContent = error.message;
    }
};

function toast(message) {
    const element = $('authError');

    if (!element) {
        console.error(message);
        return;
    }

    element.textContent = message;

    setTimeout(() => {
        if (element.textContent === message) {
            element.textContent = '';
        }
    }, 3500);
}

restoreSession();

setInterval(() => {
    if (!token || !currentUser) return;

    loadChats();

    if (activeChat) {
        loadMessages();
    }
}, 5000);