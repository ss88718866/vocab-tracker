import React, { useState, useEffect } from 'react';
import { 
  Search, Plus, Trash2, CheckCircle, Circle, 
  Loader2, BookOpen, AlertCircle, X, Tag, Cloud, CloudOff
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';

// 1. 初始化 Firebase (完美适配 Vercel 环境)
let app, auth, db, rootAppId;

try {
  let fbApiKey = "", fbAuthDomain = "", fbProjectId = "", fbStorageBucket = "", fbMessagingSenderId = "", fbAppId = "", fbMeasurementId = "";
  
  try { fbApiKey = import.meta.env.VITE_FB_API_KEY; } catch (e) {}
  try { fbAuthDomain = import.meta.env.VITE_FB_AUTH_DOMAIN; } catch (e) {}
  try { fbProjectId = import.meta.env.VITE_FB_PROJECT_ID; } catch (e) {}
  try { fbStorageBucket = import.meta.env.VITE_FB_STORAGE_BUCKET; } catch (e) {}
  try { fbMessagingSenderId = import.meta.env.VITE_FB_MESSAGING_SENDER_ID; } catch (e) {}
  try { fbAppId = import.meta.env.VITE_FB_APP_ID; } catch (e) {}
  try { fbMeasurementId = import.meta.env.VITE_FB_MEASUREMENT_ID; } catch (e) {}

  if (!fbApiKey && typeof process !== 'undefined' && process.env) {
    fbApiKey = process.env.VITE_FB_API_KEY;
    fbAuthDomain = process.env.VITE_FB_AUTH_DOMAIN;
    fbProjectId = process.env.VITE_FB_PROJECT_ID;
    fbStorageBucket = process.env.VITE_FB_STORAGE_BUCKET;
    fbMessagingSenderId = process.env.VITE_FB_MESSAGING_SENDER_ID;
    fbAppId = process.env.VITE_FB_APP_ID;
    fbMeasurementId = process.env.VITE_FB_MEASUREMENT_ID;
  }

  const fbConfig = {
    apiKey: fbApiKey,
    authDomain: fbAuthDomain,
    projectId: fbProjectId,
    storageBucket: fbStorageBucket,
    messagingSenderId: fbMessagingSenderId,
    appId: fbAppId,
    measurementId: fbMeasurementId
  };
  
  if (fbConfig.apiKey) {
    app = initializeApp(fbConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    // 过滤掉可能导致数据库崩溃的非法字符
    rootAppId = String(fbConfig.appId || 'custom-app').replace(/\//g, '_');
  }
} catch (err) {
  console.error("Firebase 初始化失败:", err);
}

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
    signInAnonymously(auth).catch(e => console.error("认证失败", e));
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 3. 监听云端数据库
  useEffect(() => {
    if (!user || !db || !rootAppId) return;
    
    try {
      const wordsRef = collection(db, 'artifacts', rootAppId, 'users', user.uid, 'words');
      const unsubscribe = onSnapshot(wordsRef, (snapshot) => {
        const wordsData = [];
        snapshot.forEach(docSnap => wordsData.push({ id: docSnap.id, ...docSnap.data() }));
        setWords(wordsData);
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("Firebase 监听设置失败:", e);
    }
  }, [user]);

  const uniqueCategories = ['all', ...new Set(words.map(w => w.category).filter(Boolean))];

  // 4. 调用 AI 解析单词
  const fetchWordData = async (word) => {
    let apiKey = "";
    try { apiKey = import.meta.env.VITE_GEMINI_API_KEY; } catch (e) {}
    if (!apiKey && typeof process !== 'undefined' && process.env) {
      apiKey = process.env.VITE_GEMINI_API_KEY;
    }
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const payload = {
      contents: [{ parts: [{ text: `Please provide the Chinese translation, an English example sentence, the Chinese translation of the example sentence, a suitable semantic category (in Chinese, e.g., '食物', '动作', max 4 characters), and the British English phonetic transcription (IPA format) for: "${word}". Make sure it strictly follows British English standards.` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            translation: { type: "STRING" }, example: { type: "STRING" },
            exampleTranslation: { type: "STRING" }, category: { type: "STRING" },
            phonetic: { type: "STRING" }
          },
          required: ["translation", "example", "exampleTranslation", "category", "phonetic"]
        }
      }
    };

    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error("获取单词信息失败，请重试。");
    const data = await res.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
  };

  const handleAddWord = async (e) => {
    e.preventDefault();
    if (!user || !db) return setErrorMsg("云端数据库未连接，请检查配置。");
    const cleanWord = inputText.trim();
    if (!cleanWord) return;
    if (words.some(w => String(w.word).toLowerCase() === cleanWord.toLowerCase())) return setErrorMsg(`单词 "${cleanWord}" 已存在！`);

    setIsAdding(true);
    setErrorMsg(null);

    try {
      const generatedData = await fetchWordData(cleanWord);
      const newWord = {
        id: crypto.randomUUID(),
        word: String(cleanWord),
        phonetic: String(generatedData.phonetic || ''),
        translation: String(generatedData.translation || '无翻译'),
        example: String(generatedData.example || '无例句'),
        exampleTranslation: String(generatedData.exampleTranslation || ''),
        category: String(generatedData.category || '其他'),
        memorized: false,
        addedAt: Date.now()
      };
      await setDoc(doc(db, 'artifacts', rootAppId, 'users', user.uid, 'words', newWord.id), newWord);
      setInputText('');
    } catch (err) {
      setErrorMsg(String(err.message || "未知错误"));
    } finally {
      setIsAdding(false);
    }
  };

  const toggleMemorized = async (id) => {
    if (!user || !db || !rootAppId) return;
    const word = words.find(w => w.id === id);
    if (word) await setDoc(doc(db, 'artifacts', rootAppId, 'users', user.uid, 'words', id), { memorized: !word.memorized }, { merge: true });
  };

  const deleteWord = async (id) => {
    if (!user || !db || !rootAppId) return;
    await deleteDoc(doc(db, 'artifacts', rootAppId, 'users', user.uid, 'words', id));
  };

  const filteredWords = words
    .filter(w => statusFilter === 'all' ? true : statusFilter === 'learning' ? !w.memorized : w.memorized)
    .filter(w => categoryFilter === 'all' ? true : w.category === categoryFilter)
    .filter(w => String(w.word).toLowerCase().includes(searchQuery.toLowerCase()) || String(w.translation).includes(searchQuery))
    .sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-3 rounded-xl text-blue-600 relative">
              <BookOpen size={28} />
              {user && db ? (
                <div className="absolute -top-1 -right-1 bg-green-500 text-white rounded-full p-0.5 border-2 border-white" title="已连接"><Cloud size={10} /></div>
              ) : (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 border-2 border-white" title="未连接"><CloudOff size={10} /></div>
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">VocabTracker</h1>
              <p className="text-sm text-gray-500">{user && db ? '数据已开启多端实时同步' : '数据库连接中...'}</p>
            </div>
          </div>

          <form onSubmit={handleAddWord} className="flex gap-2 w-full md:w-auto">
            <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="输入一个英语单词..." className="flex-1 md:w-64 px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500" disabled={isAdding || !user || !db} />
            <button type="submit" disabled={isAdding || !inputText.trim() || !user || !db} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
              {isAdding ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              <span className="hidden sm:inline">{isAdding ? '解析中...' : '添加'}</span>
            </button>
          </form>
        </header>

        {errorMsg && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl flex items-start justify-between shadow-sm">
            <div className="flex items-center gap-3"><AlertCircle className="text-red-500" size={20} /><p className="text-red-700 text-sm font-medium">{String(errorMsg)}</p></div>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600"><X size={18} /></button>
          </div>
        )}

        <div className="flex flex-col space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex bg-white rounded-xl shadow-sm border border-gray-100 p-1 w-full sm:w-auto">
              {['all', 'learning', 'memorized'].map((f) => (
                <button key={f} onClick={() => setStatusFilter(f)} className={`flex-1 sm:px-6 py-2 rounded-lg text-sm font-medium transition-all ${statusFilter === f ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                  {f === 'all' && '全部状态'}{f === 'learning' && '学习中'}{f === 'memorized' && '已掌握'}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索云端单词..." className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl shadow-sm border border-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
          </div>
          
          {uniqueCategories.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
              <Tag size={16} className="text-gray-400 shrink-0 ml-1" />
              {uniqueCategories.map(cat => (
                <button key={cat} onClick={() => setCategoryFilter(cat)} className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-medium border ${categoryFilter === cat ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {cat === 'all' ? '全部分类' : String(cat)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase w-1/4">单词 & 释义</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase w-1/2">例句</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-500 uppercase w-1/4">状态 & 操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filteredWords.length > 0 ? filteredWords.map((word) => (
                  <tr key={word.id} className="hover:bg-gray-50/50 group">
                    <td className="px-6 py-4">
                      <div className="flex flex-col items-start">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-lg font-bold ${word.memorized ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{String(word.word)}</span>
                          {word.phonetic && <span className={`font-mono text-sm ${word.memorized ? 'text-gray-400' : 'text-gray-500'}`}>{String(word.phonetic)}</span>}
                        </div>
                        <span className="text-sm text-blue-600 font-medium mt-1">{String(word.translation)}</span>
                        {word.category && <span className={`mt-2 px-2 py-0.5 text-[10px] rounded border ${word.memorized ? 'bg-gray-50 border-gray-200 text-gray-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>{String(word.category)}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 max-w-lg">
                        <span className={`text-sm ${word.memorized ? 'text-gray-400' : 'text-gray-700'} font-medium`}>{String(word.example)}</span>
                        <span className="text-xs text-gray-500 mt-1">{String(word.exampleTranslation)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-3">
                        <button onClick={() => toggleMemorized(word.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${word.memorized ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {word.memorized ? <><CheckCircle size={16} /> 已掌握</> : <><Circle size={16} /> 学习中</>}
                        </button>
                        <button onClick={() => deleteWord(word.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 sm:opacity-100"><Trash2 size={18} /></button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan="3" className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center text-gray-400 gap-3">
                        <BookOpen size={48} className="opacity-20" />
                        <p className="text-base font-medium">云端词库空空如也</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}