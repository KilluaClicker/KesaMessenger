import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform,
  Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text,
  TextInput, View, RefreshControl
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

const SERVER = 'https://kesa-messenger.onrender.com';
const C = {
  bg:'#0B0914', panel:'#141020', panel2:'#1C1630', border:'#302447',
  purple:'#9B6DFF', purple2:'#6C45D9', text:'#F7F3FF', muted:'#A69BB9',
  green:'#4BE0A5', red:'#FF6E91'
};

async function api(path, token, options={}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${SERVER}${path}`, {...options, headers});
  } catch {
    throw new Error('Не удалось подключиться к KESA. Проверь интернет и сервер.');
  }
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Ошибка сервера (${response.status})`);
  return data;
}

function Button({title, onPress, secondary=false, disabled=false}) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary, disabled && {opacity:.55}]}>
    <Text style={[styles.buttonText, secondary && {color:C.text}]}>{title}</Text>
  </Pressable>;
}
function Field(props) {
  return <TextInput placeholderTextColor={C.muted} selectionColor={C.purple} style={styles.input} {...props} />;
}
function Header({title, subtitle, right}) {
  return <View style={styles.header}><View><Text style={styles.headerTitle}>{title}</Text>{subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}</View>{right}</View>;
}
function Avatar({name, size=44}) {
  const letter = (name || '?').slice(0,1).toUpperCase();
  return <LinearGradient colors={['#B08AFF','#6036C6']} style={{width:size,height:size,borderRadius:size/3,alignItems:'center',justifyContent:'center'}}>
    <Text style={{color:'white',fontSize:size*.42,fontWeight:'800'}}>{letter}</Text>
  </LinearGradient>;
}

export default function App() {
  const [token,setToken] = useState('');
  const [user,setUser] = useState(null);
  const [authMode,setAuthMode] = useState('login');
  const [username,setUsername] = useState('');
  const [password,setPassword] = useState('');
  const [loading,setLoading] = useState(true);
  const [tab,setTab] = useState('chats');
  const [chats,setChats] = useState([]);
  const [activeChat,setActiveChat] = useState(null);
  const [messages,setMessages] = useState([]);
  const [draft,setDraft] = useState('');
  const [search,setSearch] = useState('');
  const [results,setResults] = useState([]);
  const [groupName,setGroupName] = useState('');
  const [refreshing,setRefreshing] = useState(false);
  const [busy,setBusy] = useState(false);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync('kesa_token');
    setToken(''); setUser(null); setActiveChat(null); setMessages([]); setChats([]);
  }, []);

  const loadChats = useCallback(async (t=token) => {
    if (!t) return;
    try { const d=await api('/api/chats',t); setChats(d.chats || []); }
    catch(e) { if (/401|сесс|войдите в аккаунт/i.test(e.message)) Alert.alert('KESA', e.message); }
  }, [token]);

  const restore = useCallback(async () => {
    try {
      const saved = await SecureStore.getItemAsync('kesa_token');
      if (!saved) { setLoading(false); return; }
      const d = await api('/api/me',saved);
      if (!d.user) throw new Error('Не удалось восстановить профиль');
      setToken(saved); setUser(d.user);
      await loadChats(saved);
    } catch (e) {
      // Do not delete saved token for transient network/server errors.
      if (/401|сессия недействительна|войдите в аккаунт заново/i.test(e.message)) {
        await SecureStore.deleteItemAsync('kesa_token');
      } else {
        Alert.alert('Не удалось подключиться', e.message);
      }
    } finally { setLoading(false); }
  }, [loadChats]);

  useEffect(() => { restore(); }, []);

  async function authenticate() {
    if (busy) return;
    if (!username.trim() || !password) return Alert.alert('Заполни поля', 'Нужны имя пользователя и пароль.');
    setBusy(true);
    try {
      const d = await api(`/api/auth/${authMode}`, '', {
        method:'POST', body:JSON.stringify({username:username.trim(),password})
      });
      if (!d.token || !d.user) throw new Error('Сервер не вернул токен или профиль.');
      await SecureStore.setItemAsync('kesa_token',d.token);
      setToken(d.token); setUser(d.user); setPassword('');
      await loadChats(d.token);
    } catch(e) { Alert.alert(authMode==='login'?'Не удалось войти':'Не удалось зарегистрироваться',e.message); }
    finally { setBusy(false); }
  }

  async function openChat(chat) {
    setActiveChat(chat); setTab('chats');
    try {
      const d = await api(`/api/chats/${encodeURIComponent(chat.id)}/messages`,token);
      setMessages(d.messages || []);
    } catch(e) { Alert.alert('Не удалось открыть чат',e.message); }
  }

  async function refreshMessages() {
    if (!activeChat) return loadChats();
    setRefreshing(true);
    try {
      const d=await api(`/api/chats/${encodeURIComponent(activeChat.id)}/messages`,token);
      setMessages(d.messages || []);
    } catch(e) { Alert.alert('Ошибка',e.message); }
    finally { setRefreshing(false); }
  }

  async function sendMessage() {
    const content=draft.trim();
    if (!content || !activeChat) return;
    setBusy(true);
    try {
      await api(`/api/chats/${encodeURIComponent(activeChat.id)}/messages`,token,{
        method:'POST',body:JSON.stringify({content,kind:'text'})
      });
      setDraft('');
      const d=await api(`/api/chats/${encodeURIComponent(activeChat.id)}/messages`,token);
      setMessages(d.messages || []);
    } catch(e) { Alert.alert('Сообщение не отправлено',e.message); }
    finally { setBusy(false); }
  }

  async function searchUsers() {
    if (!search.trim()) return;
    setBusy(true);
    try {
      const d=await api(`/api/users/search?q=${encodeURIComponent(search.trim())}`,token);
      setResults(d.users || d.results || []);
      if (!(d.users || d.results || []).length) Alert.alert('Никого не найдено','Попробуй другое имя пользователя.');
    } catch(e) { Alert.alert('Поиск пользователей',e.message); }
    finally { setBusy(false); }
  }

  async function createDirect(item) {
    setBusy(true);
    try {
      const d=await api('/api/chats/direct',token,{method:'POST',body:JSON.stringify({username:item.username})});
      await loadChats();
      if (d.chat) await openChat(d.chat);
      else Alert.alert('Готово','Диалог создан. Найди его в списке чатов.');
    } catch(e) { Alert.alert('Не удалось создать диалог',e.message); }
    finally { setBusy(false); }
  }

  async function createGroup() {
    if (!groupName.trim()) return Alert.alert('Название группы','Введи название группы.');
    setBusy(true);
    try {
      const d=await api('/api/chats/group',token,{method:'POST',body:JSON.stringify({title:groupName.trim()})});
      setGroupName(''); await loadChats();
      if (d.chat) await openChat(d.chat);
      else Alert.alert('Группа создана','Она должна появиться в списке чатов.');
    } catch(e) { Alert.alert('Не удалось создать группу',e.message); }
    finally { setBusy(false); }
  }

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={C.purple}/><Text style={styles.sub}>Подключаем KESA…</Text></SafeAreaView>;

  if (!user) return <SafeAreaView style={styles.screen}>
    <ExpoStatusBar style="light"/>
    <LinearGradient colors={['#21143D','#0B0914','#0B0914']} style={styles.authGlow}>
      <View style={styles.logo}><Text style={styles.logoText}>K</Text></View>
      <Text style={styles.brand}>KESA</Text><Text style={styles.tagline}>Твоё пространство для общения</Text>
      <View style={styles.authCard}>
        <Text style={styles.title}>{authMode==='login'?'С возвращением':'Создать аккаунт'}</Text>
        <Text style={styles.sub}>{authMode==='login'?'Войди, чтобы продолжить общение':'Присоединяйся к KESA'}</Text>
        <Field value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="Имя пользователя" />
        <Field value={password} onChangeText={setPassword} placeholder="Пароль" secureTextEntry />
        <Button title={busy?'Подождите…':authMode==='login'?'Войти в KESA  ↗':'Создать аккаунт  ↗'} onPress={authenticate} disabled={busy}/>
        <Pressable onPress={()=>setAuthMode(authMode==='login'?'register':'login')} style={styles.switchAuth}>
          <Text style={styles.sub}>{authMode==='login'?'Нет аккаунта? ':'Уже есть аккаунт? '}<Text style={{color:C.purple,fontWeight:'700'}}>{authMode==='login'?'Регистрация':'Войти'}</Text></Text>
        </Pressable>
      </View>
      <Text style={styles.footer}>БЕТА · KESA MESSENGER</Text>
    </LinearGradient>
  </SafeAreaView>;

  const chatList = () => <FlatList
    data={chats} keyExtractor={(item,index)=>String(item.id ?? index)}
    contentContainerStyle={{padding:16,paddingBottom:30}}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);loadChats().finally(()=>setRefreshing(false));}} tintColor={C.purple}/>}
    ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>✦</Text><Text style={styles.title}>Пока тихо</Text><Text style={styles.sub}>Начни новый диалог или найди друзей.</Text><Button title="Найти друзей" onPress={()=>setTab('friends')}/></View>}
    renderItem={({item})=><Pressable style={styles.chatRow} onPress={()=>openChat(item)}><Avatar name={item.title}/><View style={{flex:1}}><Text style={styles.rowTitle}>{item.title || 'Чат'}</Text><Text style={styles.sub}>{item.type==='group'?'Групповая беседа':'Личные сообщения'}</Text></View><Text style={styles.chevron}>›</Text></Pressable>}
  />;

  return <SafeAreaView style={styles.screen}>
    <ExpoStatusBar style="light"/>
    {activeChat && tab==='chats' ? <>
      <Header title={activeChat.title || 'Чат'} subtitle={activeChat.type==='group'?'ГРУППОВОЙ ЧАТ':'ЛИЧНЫЕ СООБЩЕНИЯ'} right={<Pressable onPress={()=>setActiveChat(null)}><Text style={styles.back}>‹ Назад</Text></Pressable>}/>
      <FlatList data={messages} keyExtractor={(m,i)=>String(m.id ?? `${m.created_at}-${i}`)} contentContainerStyle={{padding:16}}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshMessages} tintColor={C.purple}/>}
        ListEmptyComponent={<Text style={styles.sub}>Сообщений пока нет. Напиши первым!</Text>}
        renderItem={({item})=><View style={styles.message}><Text style={styles.messageName}>{item.username || 'Пользователь'}</Text><Text style={styles.messageText}>{item.kind==='voice'?'🎙 Голосовое сообщение':item.kind==='file'?'📎 '+(item.file_name||'Файл'):(item.content||'')}</Text><Text style={styles.messageTime}>{item.created_at ? new Date(item.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</Text></View>}
      />
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} keyboardVerticalOffset={80} style={styles.composer}>
        <Field value={draft} onChangeText={setDraft} placeholder="Написать сообщение…" multiline style={[styles.input,{flex:1,maxHeight:100}]}/>
        <Pressable style={styles.sendButton} onPress={sendMessage} disabled={busy}><Text style={styles.sendText}>➤</Text></Pressable>
      </KeyboardAvoidingView>
    </> : <>
      <Header title="KESA" subtitle={`Привет, ${user.username || 'друг'} ✨`} right={<Pressable onPress={()=>Alert.alert('Аккаунт',`Ты вошёл как ${user.username}`, [{text:'Выйти',style:'destructive',onPress:logout},{text:'Закрыть'}])}><Avatar name={user.username} size={42}/></Pressable>}/>
      <View style={styles.content}>
        {tab==='chats' && <><View style={styles.sectionTitle}><Text style={styles.title}>Твои чаты</Text><Pressable onPress={()=>setTab('groups')}><Text style={styles.action}>＋ Группа</Text></Pressable></View>{chatList()}</>}
        {tab==='friends' && <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.tabPage}><Text style={styles.title}>Найти друзей</Text><Text style={styles.sub}>Ищи людей по имени пользователя.</Text><View style={styles.searchLine}><Field value={search} onChangeText={setSearch} placeholder="Введи имя пользователя" autoCapitalize="none" style={[styles.input,{flex:1}]}/><Button title="Поиск" onPress={searchUsers} disabled={busy}/></View>{results.map((item,index)=><View key={String(item.id ?? index)} style={styles.chatRow}><Avatar name={item.username}/><View style={{flex:1}}><Text style={styles.rowTitle}>{item.username || 'Пользователь'}</Text></View><Pressable onPress={()=>createDirect(item)}><Text style={styles.action}>Написать</Text></Pressable></View>)}</ScrollView>}
        {tab==='groups' && <View style={styles.tabPage}><Text style={styles.title}>Новая группа</Text><Text style={styles.sub}>Создай отдельное пространство для своей компании.</Text><Field value={groupName} onChangeText={setGroupName} placeholder="Название группы"/><Button title={busy?'Создаём…':'Создать группу'} onPress={createGroup} disabled={busy}/><Text style={[styles.sub,{marginTop:20}]}>Участников можно будет добавлять, если это поддерживает серверная версия KESA.</Text></View>}
        {tab==='calls' && <View style={styles.empty}><Text style={styles.emptyIcon}>◉</Text><Text style={styles.title}>Звонки KESA</Text><Text style={styles.sub}>Экран звонков готов к интеграции, но для реальных аудио- и видеозвонков сервер должен поддерживать WebRTC-сигнализацию и мобильный клиентский модуль. Текущие API проверяются при подключении.</Text><Button title="Обновить чаты" onPress={loadChats} secondary/></View>}
        {tab==='profile' && <View style={styles.tabPage}><Text style={styles.title}>Твой профиль</Text><View style={styles.profileCard}><Avatar name={user.username} size={76}/><Text style={styles.profileName}>{user.username}</Text><Text style={styles.sub}>KESA Messenger · Beta</Text></View><Button title="Выйти из аккаунта" secondary onPress={()=>Alert.alert('Выйти из KESA?','Токен будет удалён с этого устройства.',[{text:'Отмена',style:'cancel'},{text:'Выйти',style:'destructive',onPress:logout}])}/><Text style={styles.sub}>Вход сохраняется защищённо на устройстве.</Text></View>}
      </View>
      <View style={styles.tabBar}>
        {[['chats','▤','Чаты'],['friends','⌕','Друзья'],['groups','＋','Группы'],['calls','◉','Звонки'],['profile','●','Профиль']].map(([key,icon,label])=><Pressable key={key} style={styles.tabItem} onPress={()=>{setActiveChat(null);setTab(key);}}><Text style={[styles.tabIcon,tab===key&&styles.tabActive]}>{icon}</Text><Text style={[styles.tabLabel,tab===key&&styles.tabActive]}>{label}</Text></Pressable>)}
      </View>
    </>}
  </SafeAreaView>;
}

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:C.bg}, center:{flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center',gap:12},
  authGlow:{flex:1,alignItems:'center',justifyContent:'center',padding:24},
  logo:{width:66,height:66,borderRadius:22,backgroundColor:C.purple,alignItems:'center',justifyContent:'center',shadowColor:C.purple,shadowOpacity:.45,shadowRadius:24,elevation:12},
  logoText:{fontSize:39,color:'#fff',fontWeight:'900'},brand:{color:C.text,fontSize:30,fontWeight:'900',letterSpacing:4,marginTop:12},tagline:{color:C.muted,marginTop:4,marginBottom:28},
  authCard:{width:'100%',maxWidth:420,backgroundColor:C.panel,borderColor:C.border,borderWidth:1,borderRadius:26,padding:22},
  title:{fontSize:22,fontWeight:'800',color:C.text,marginBottom:6},sub:{fontSize:13,color:C.muted,lineHeight:19},
  input:{backgroundColor:C.panel2,borderWidth:1,borderColor:C.border,borderRadius:14,paddingHorizontal:14,paddingVertical:13,color:C.text,fontSize:15,marginTop:12,minHeight:48},
  button:{backgroundColor:C.purple2,borderRadius:14,paddingVertical:14,paddingHorizontal:18,alignItems:'center',justifyContent:'center',marginTop:14},
  buttonSecondary:{backgroundColor:C.panel2,borderWidth:1,borderColor:C.border},buttonText:{color:'#fff',fontWeight:'800',fontSize:14},
  switchAuth:{alignItems:'center',paddingTop:18},footer:{color:'#726687',fontSize:10,letterSpacing:2,marginTop:24},
  header:{minHeight:82,paddingHorizontal:18,paddingVertical:15,borderBottomColor:C.border,borderBottomWidth:1,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  headerTitle:{fontSize:24,fontWeight:'900',color:C.text},content:{flex:1},sectionTitle:{paddingHorizontal:18,paddingTop:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  action:{color:C.purple,fontWeight:'800'},chatRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:13,borderBottomColor:C.border,borderBottomWidth:1},
  rowTitle:{color:C.text,fontWeight:'700',fontSize:15,marginBottom:4},chevron:{color:C.muted,fontSize:25,paddingHorizontal:8},
  empty:{alignItems:'center',justifyContent:'center',padding:28,gap:8},emptyIcon:{color:C.purple,fontSize:44,marginBottom:8},
  tabPage:{padding:18},searchLine:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:14},tabBar:{height:70,borderTopColor:C.border,borderTopWidth:1,backgroundColor:C.panel,flexDirection:'row',justifyContent:'space-around',alignItems:'center',paddingBottom:6},
  tabItem:{alignItems:'center',justifyContent:'center',flex:1},tabIcon:{fontSize:21,color:C.muted},tabLabel:{fontSize:10,color:C.muted,marginTop:4},tabActive:{color:C.purple,fontWeight:'900'},
  message:{backgroundColor:C.panel,borderWidth:1,borderColor:C.border,borderRadius:15,padding:13,marginBottom:10,maxWidth:'92%',alignSelf:'flex-start'},
  messageName:{color:C.purple,fontSize:12,fontWeight:'800',marginBottom:5},messageText:{color:C.text,fontSize:15,lineHeight:21},messageTime:{color:C.muted,fontSize:10,marginTop:6,alignSelf:'flex-end'},
  composer:{flexDirection:'row',alignItems:'flex-end',paddingHorizontal:12,paddingVertical:10,borderTopWidth:1,borderTopColor:C.border,gap:8},sendButton:{backgroundColor:C.purple2,width:48,height:48,borderRadius:15,alignItems:'center',justifyContent:'center',marginTop:12},sendText:{color:'#fff',fontSize:21,fontWeight:'900'},
  back:{color:C.purple,fontWeight:'700'},profileCard:{alignItems:'center',backgroundColor:C.panel,borderColor:C.border,borderWidth:1,borderRadius:22,padding:24,marginVertical:20},profileName:{color:C.text,fontSize:20,fontWeight:'800',marginTop:12}
});
