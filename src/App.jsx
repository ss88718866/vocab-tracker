import React, { useState, useEffect } from 'react';
import { 
  Search, Plus, Trash2, CheckCircle, Circle, 
  Loader2, BookOpen, AlertCircle, X, Tag, Cloud, CloudOff
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';

// 1. 稳健的环境变量读取函数
const getSecret = (key) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      return import.meta.env[key];
    }
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
  } catch (e) {}
  return "";
};

// 2. 初始化 Firebase
let app, auth, db, rootAppId;

const initSystem = () => {
  try {
    const config = {
      apiKey: getSecret('VITE_FB_API_KEY'),
      authDomain: getSecret('VITE_FB_AUTH_DOMAIN'),
      projectId: getSecret('VITE_FB_PROJECT_ID'),
      storageBucket: getSecret('VITE_FB_STORAGE_BUCKET'),
      messagingSenderId: getSecret('VITE_FB_MESSAGING_SENDER_ID'),
      appId: getSecret('VITE_FB_APP_ID'),
      measurementId: getSecret('VITE_FB_MEASUREMENT_ID')
    };

    if (config.apiKey) {
      app = initializeApp(config);
      auth = getAuth(app);
      db = getFirestore(app);
      rootAppId = String(config.appId || 'default-app').replace(/\//g, '_');
      return true;
    }
    return false;
  } catch (err) {
    console.error("Firebase 初始化失败:", err);
    return false;
  }
};

initSystem();

export default function App() {
  const [words, setWords] = useState([]);
  const [user, setUser] = useState(null);
  const [inputText, setInputText] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!auth) return;
    signInAnonymously(auth).catch(() => {});
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db || !rootAppId) return;
    const colRef = collection(db, 'artifacts', rootAppId, 'users', user.uid, 'words');
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const data = [];
      snapshot.forEach(docSnap => data.push({ id: docSnap.id, ...docSnap.data() }));
      setWords(data);
    }, (err) => {
      setErrorMsg("数据库连接受阻，请检查 Vercel 变量配置。");
    });
    return () => unsubscribe();
  }, [user]);

  // 3. AI 脑细胞：增加详细错误反馈
  const fetchAI = async (word) => {
    const apiKey = getSecret('VITE_GEMINI_API_KEY');
    if (!apiKey) throw new Error("缺少 AI 密钥 (VITE_GEMINI_API_KEY)。请在 Vercel 环境变量中添加并重新部署。");
    
    // 🌟 按照您的建议，已强制切换为最基础、最稳定、权限要求最低的基础模型
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const payload = {
      contents: [{ parts: [{ text: `Provide Chinese translation, British IPA, one English example, and its Chinese translation for word: "${word}". Output in strict JSON format.` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            translation: { type: "STRING" },
            example: { type: "STRING" },
            exampleTranslation: { type: "STRING" },
            phonetic: { type: "STRING" },
            category: { type: "STRING" }
          },
          required: ["translation", "example", "exampleTranslation", "phonetic"]
        }
      }
    };

    // 增加了专门针对国内网络直连 Google API 失败的拦截提示
    const res = await fetch(url, { 
      method: "POST", 
      headers: { "Content-Type": "application/json" }, 
      body: JSON.stringify(payload) 
    }).catch(err => {
      throw new Error("网络请求被拦截：请检查您的网络环境，或者是否开启了全局代理以访问 Google 服务。");
    });
    
    if (!res.ok) {
        const errorDetail = await res.json().catch(() => ({}));
        if (res.status === 403) throw new Error("AI 密钥权限不足(403)。请确认您的账号未被限制，或尝试重新生成 Key。");
        if (res.status === 400) throw new Error("API Key 无效或格式错误(400)，请检查 Vercel 环境变量中是否填错。");
        if (res.status === 404) throw new Error("找不到该基础 AI 模型(404)。");
        throw new Error(`AI 解析失败 (状态码: ${res.status})。`);
    }
    
    const json = await res.json();
    return JSON.parse(json.candidates[0].content.parts[0].text);
  };

  const handleAddWord = async (e) => {
    e.preventDefault();
    const word = inputText.trim();
    if (!word || !user || isAdding) return;
    
    if (words.some(w => String(w.word).toLowerCase() === word.toLowerCase())) {
        setErrorMsg(`单词 "${word}" 已经存在。`);
        return;
    }

    setIsAdding(true);
    setErrorMsg(null);
    try {
      const ai = await fetchAI(word);
      const newWord = {
        id: crypto.randomUUID(),
        word: word,
        phonetic: ai.phonetic || '',
        translation: ai.translation || '',
        example: ai.example || '',
        exampleTranslation: ai.exampleTranslation || '',
        category: ai.category || '通用',
        memorized: false,
        addedAt: Date.now()
      };
      await setDoc(doc(db, 'artifacts', rootAppId, 'users', user.uid, 'words', newWord.id), newWord);
      setInputText('');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const toggleStatus = async (w) => {
    await setDoc(doc(db, 'artifacts', rootAppId, 'users', user.uid, 'words', w.id), { memorized: !w.memorized }, { merge: true });
  };

  const removeWord = async (id) => {
    await deleteDoc(doc(db, 'artifacts', rootAppId, 'users', user.uid, 'words', id));
  };

  const filtered = words
    .filter(w => statusFilter === 'all' ? true : statusFilter === 'learning' ? !w.memorized : w.memorized)
    .filter(w => String(w.word).toLowerCase().includes(searchQuery.toLowerCase()) || String(w.translation).includes(searchQuery))
    .sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans p-4 md:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* 精美头部 */}
        <div className="bg-white p-8 rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-5">
            <div className={`p-4 rounded-3xl transition-all duration-500 shadow-xl ${user ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-slate-100 text-slate-400'}`}>
              <BookOpen size={36} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-800">VocabTracker</h1>
              <div className="mt-1.5">
                {user ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-600 border border-emerald-100 uppercase tracking-wider">
                    <Cloud size={14} strokeWidth={3} /> 数据云端同步中
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-600 animate-pulse">
                    <Loader2 size={14} className="animate-spin" /> 正在连通云端...
                  </span>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleAddWord} className="flex w-full md:w-auto gap-3">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入英语生词..."
              className="flex-1 md:w-64 px-6 py-4 rounded-[1.5rem] bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white focus:outline-none transition-all font-bold placeholder:text-slate-400"
              disabled={isAdding || !user}
            />
            <button
              type="submit"
              disabled={isAdding || !inputText.trim() || !user}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-[1.5rem] font-black shadow-lg shadow-blue-200 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {isAdding ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} strokeWidth={3} />}
              添加
            </button>
          </form>
        </div>

        {errorMsg && (
          <div className="bg-rose-50 border-2 border-rose-100 text-rose-700 p-5 rounded-[1.5rem] flex items-center justify-between shadow-sm animate-in slide-in-from-top-4">
            <div className="flex items-center gap-3">
              <AlertCircle size={22} strokeWidth={2.5} />
              <span className="text-sm font-bold tracking-tight leading-relaxed">{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg(null)} className="hover:bg-rose-100 p-2 rounded-full transition-colors"><X size={18} /></button>
          </div>
        )}

        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center px-2">
            <div className="flex p-1.5 bg-white rounded-2xl border border-slate-200 shadow-sm w-full sm:w-auto">
              {['all', 'learning', 'memorized'].map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`flex-1 px-6 py-2.5 rounded-xl text-sm font-black transition-all ${
                    statusFilter === f ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {f === 'all' ? '全部' : f === 'learning' ? '学习中' : '已掌握'}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索单词..."
                className="w-full pl-11 pr-5 py-3.5 bg-white rounded-2xl border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filtered.length > 0 ? filtered.map(w => (
              <div key={w.id} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:border-blue-100 transition-all group flex flex-col md:flex-row justify-between gap-6 overflow-hidden">
                <div className="space-y-4 flex-1">
                  <div className="flex items-baseline gap-3">
                    <h3 className={`text-2xl font-black ${w.memorized ? 'text-slate-300 line-through' : 'text-slate-900'}`}>{w.word}</h3>
                    <span className="text-sm font-mono font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-lg italic">[{w.phonetic}]</span>
                    <span className="text-blue-600 font-black text-xl">{w.translation}</span>
                  </div>
                  <div className={`p-5 rounded-2xl border-l-4 transition-all ${w.memorized ? 'bg-slate-50/50 border-slate-200' : 'bg-blue-50/30 border-blue-500'}`}>
                    <p className={`text-[15px] leading-relaxed font-bold ${w.memorized ? 'text-slate-400' : 'text-slate-700'} italic`}>"{w.example}"</p>
                    <p className="text-xs font-black text-slate-400 mt-2 uppercase tracking-widest">{w.exampleTranslation}</p>
                  </div>
                </div>
                
                <div className="flex md:flex-col justify-end gap-3 shrink-0">
                  <button 
                    onClick={() => toggleStatus(w)}
                    className={`flex-1 md:flex-none px-6 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all ${
                      w.memorized ? 'bg-emerald-50 text-emerald-600 shadow-inner' : 'bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-600'
                    }`}
                  >
                    {w.memorized ? <CheckCircle size={20} strokeWidth={3} /> : <Circle size={20} strokeWidth={3} />}
                    {w.memorized ? "已掌握" : "记一下"}
                  </button>
                  <button 
                    onClick={() => removeWord(w.id)}
                    className="p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all"
                  >
                    <Trash2 size={20} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            )) : (
              <div className="py-24 flex flex-col items-center justify-center text-slate-200 bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
                <BookOpen size={100} strokeWidth={1} className="mb-4 opacity-10" />
                <p className="text-xl font-black tracking-tight text-slate-300">还没有添加任何单词哦</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}