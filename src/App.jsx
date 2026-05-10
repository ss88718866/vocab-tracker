import React, { useState, useEffect } from 'react';
import { 
  Search, Plus, Trash2, CheckCircle, Circle, 
  Loader2, BookOpen, AlertCircle, X, Tag, Cloud, CloudOff
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';

// 1. 初始化 Firebase 环境配置 (完美适配 Vercel 与 Vite 环境)
let app, auth, db, rootAppId;

const initFirebase = () => {
  try {
    // 自动适配环境：优先读取 Vite 环境变量，若无则尝试全局注入
    const getEnv = (key) => {
      try {
        return import.meta.env[key] || "";
      } catch (e) {
        return "";
      }
    };

    const fbConfig = {
      apiKey: getEnv('VITE_FB_API_KEY'),
      authDomain: getEnv('VITE_FB_AUTH_DOMAIN'),
      projectId: getEnv('VITE_FB_PROJECT_ID'),
      storageBucket: getEnv('VITE_FB_STORAGE_BUCKET'),
      messagingSenderId: getEnv('VITE_FB_MESSAGING_SENDER_ID'),
      appId: getEnv('VITE_FB_APP_ID'),
      measurementId: getEnv('VITE_FB_MEASUREMENT_ID')
    };

    if (fbConfig.apiKey) {
      app = initializeApp(fbConfig);
      auth = getAuth(app);
      db = getFirestore(app);
      // 修正路径：确保 appId 中没有斜杠，防止 Firestore 报错 (segments error)
      rootAppId = String(fbConfig.appId || 'custom-app').replace(/\//g, '_').replace(/:/g, '_');
      return true;
    }
    return false;
  } catch (err) {
    console.error("Firebase 初始化失败:", err);
    return false;
  }
};

initFirebase();

export default function App() {
  const [words, setWords] = useState([]);
  const [user, setUser] = useState(null);
  const [inputText, setInputText] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // 2. 账号静默登录
  useEffect(() => {
    if (!auth) return;
    const performLogin = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.error("认证失败", e);
      }
    };
    performLogin();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // 3. 实时连接并监听云端数据库
  useEffect(() => {
    if (!user || !db || !rootAppId) return;
    
    try {
      // 核心修复：确保路径段数为奇数 (artifacts -> id -> users -> uid -> words)
      const wordsRef = collection(db, 'artifacts', rootAppId, 'users', user.uid, 'words');

      const unsubscribe = onSnapshot(wordsRef, (snapshot) => {
        const wordsData = [];
        snapshot.forEach(docSnap => {
          wordsData.push({ id: docSnap.id, ...docSnap.data() });
        });
        setWords(wordsData);
      }, (error) => {
        console.error("数据库读取错误:", error);
        setErrorMsg("数据库连接受限，请确认环境变量配置正确并重新部署。");
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("监听器启动失败:", e);
    }
  }, [user]);

  const uniqueCategories = ['all', ...new Set(words.map(w => w.category).filter(Boolean))];

  // 4. 调用 AI 解析单词 (Gemini 2.5)
  const fetchWordData = async (word) => {
    const getEnv = (key) => { try { return import.meta.env[key]; } catch(e) { return ""; } };
    const apiKey = getEnv('VITE_GEMINI_API_KEY');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    
    const payload = {
      contents: [{ parts: [{ text: `Provide Chinese translation, English example, its Chinese translation, category (max 4 chars), and British phonetic for: "${word}".` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            translation: { type: "STRING" },
            example: { type: "STRING" },
            exampleTranslation: { type: "STRING" },
            category: { type: "STRING" },
            phonetic: { type: "STRING" }
          },
          required: ["translation", "example", "exampleTranslation", "category", "phonetic"]
        }
      }
    };

    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error("AI 解析失败，请检查 API Key 是否正确。");
    const data = await res.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
  };

  const handleAddWord = async (e) => {
    e.preventDefault();
    if (!user || !db) return setErrorMsg("云端数据库未连接，请检查配置。");
    const cleanWord = inputText.trim();
    if (!cleanWord) return;
    if (words.some(w => String(w.word).toLowerCase() === cleanWord.toLowerCase())) return setErrorMsg(`"${cleanWord}" 已经在词库里啦！`);

    setIsAdding(true);
    setErrorMsg(null);
    try {
      const data = await fetchWordData(cleanWord);
      const newWord = {
        id: crypto.randomUUID(),
        word: cleanWord,
        phonetic: data.phonetic || '',
        translation: data.translation || '',
        example: data.example || '',
        exampleTranslation: data.exampleTranslation || '',
        category: data.category || '通用',
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

  const toggleStatus = async (word) => {
    if (!user || !db) return;
    await setDoc(doc(db, 'artifacts', rootAppId, 'users', user.uid, 'words', word.id), { memorized: !word.memorized }, { merge: true });
  };

  const removeWord = async (id) => {
    if (!user || !db) return;
    await deleteDoc(doc(db, 'artifacts', rootAppId, 'users', user.uid, 'words', id));
  };

  const filtered = words
    .filter(w => statusFilter === 'all' ? true : statusFilter === 'learning' ? !w.memorized : w.memorized)
    .filter(w => categoryFilter === 'all' ? true : w.category === categoryFilter)
    .filter(w => String(w.word).toLowerCase().includes(searchQuery.toLowerCase()) || String(w.translation).includes(searchQuery))
    .sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* 顶部面板 */}
        <header className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${user ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'} shadow-lg shadow-blue-100`}>
              <BookOpen size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-800">VocabTracker</h1>
              <div className="flex items-center gap-2 mt-1">
                {user ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                    <Cloud size={14} /> 数据云端同步中
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                    <Loader2 size={14} className="animate-spin" /> 正在连接云端...
                  </span>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleAddWord} className="flex w-full md:w-auto gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="输入一个新单词..."
              className="flex-1 md:w-64 px-5 py-3 rounded-2xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium"
              disabled={isAdding || !user}
            />
            <button
              type="submit"
              disabled={isAdding || !inputText.trim() || !user}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold shadow-xl shadow-blue-200 transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
            >
              {isAdding ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />}
              添加
            </button>
          </form>
        </header>

        {errorMsg && (
          <div className="bg-rose-50 border border-rose-100 text-rose-700 p-4 rounded-2xl flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-3">
              <AlertCircle size={20} />
              <span className="text-sm font-bold">{String(errorMsg)}</span>
            </div>
            <button onClick={() => setErrorMsg(null)} className="hover:bg-rose-100 p-1.5 rounded-full transition-colors"><X size={18} /></button>
          </div>
        )}

        {/* 筛选过滤 */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
            <div className="flex p-1.5 bg-white rounded-2xl border border-slate-200 shadow-sm w-full sm:w-auto">
              {['all', 'learning', 'memorized'].map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`flex-1 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    statusFilter === f ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {f === 'all' ? '全部' : f === 'learning' ? '学习中' : '已掌握'}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索库中单词或翻译..."
                className="w-full pl-11 pr-5 py-3.5 bg-white rounded-2xl border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
              />
            </div>
          </div>
          
          {uniqueCategories.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-3 scrollbar-hide">
              <Tag size={16} className="text-slate-400 ml-1 shrink-0" />
              {uniqueCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-black tracking-wide border transition-all ${
                    categoryFilter === cat ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {cat === 'all' ? '全部分类' : cat.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 单词卡片网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.length > 0 ? filtered.map(word => (
            <div key={word.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl hover:border-blue-100 transition-all group relative overflow-hidden">
              <div className="flex justify-between items-start mb-4">
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h3 className={`text-2xl font-black ${word.memorized ? 'text-slate-200 line-through' : 'text-slate-800'}`}>{word.word}</h3>
                    <span className="text-sm font-mono font-bold text-slate-400 px-2 py-0.5 bg-slate-50 rounded-lg">{word.phonetic}</span>
                  </div>
                  <p className="text-blue-600 font-black text-lg">{word.translation}</p>
                </div>
                <div className="flex gap-2 relative z-10">
                  <button 
                    onClick={() => toggleStatus(word)}
                    className={`p-3 rounded-2xl transition-all ${word.memorized ? 'bg-emerald-50 text-emerald-600 shadow-inner' : 'bg-slate-50 text-slate-400 hover:bg-blue-50 hover:text-blue-600'}`}
                  >
                    {word.memorized ? <CheckCircle size={24} strokeWidth={2.5} /> : <Circle size={24} strokeWidth={2.5} />}
                  </button>
                  <button 
                    onClick={() => removeWord(word.id)}
                    className="p-3 text-slate-200 hover:text-rose-600 hover:bg-rose-50 rounded-2xl transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={22} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
              
              <div className={`p-5 rounded-2xl border-l-4 ${word.memorized ? 'bg-slate-50/50 border-slate-200' : 'bg-blue-50/30 border-blue-400'} space-y-2`}>
                <p className={`text-[15px] leading-relaxed font-bold ${word.memorized ? 'text-slate-400' : 'text-slate-700'} italic`}>"{word.example}"</p>
                <p className="text-xs font-bold text-slate-400/80">{word.exampleTranslation}</p>
              </div>

              {word.category && (
                <span className="absolute -bottom-2 -right-1 text-[45px] font-black uppercase tracking-tighter text-slate-50 select-none pointer-events-none group-hover:text-blue-50/50 transition-colors">
                  {word.category}
                </span>
              )}
            </div>
          )) : (
            <div className="col-span-full py-24 flex flex-col items-center justify-center text-slate-200 bg-white rounded-[3.5rem] border-2 border-dashed border-slate-100">
              <BookOpen size={80} strokeWidth={1} className="mb-6 opacity-10" />
              <p className="text-xl font-black tracking-tight text-slate-300">还没有添加任何单词哦</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}