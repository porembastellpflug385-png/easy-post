import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, CheckCircle2, 
  RefreshCw, ChevronRight, MessageSquare, ArrowLeft, Loader2, Sparkles, LayoutGrid,
  Library, BookOpen, Palette, Ruler, FileText, AlertTriangle, XCircle, Plus, Edit3, Image as ImageIcon
} from 'lucide-react';

/**
 * ==========================================
 * 核心配置：API与模型设置
 * ==========================================
 */
const API_CONFIG = {
  key: "这里填入你的第三方API_KEY", // <-- 请在此填入 1pix.fun 的 API Key
  baseUrl: "https://openai.1pix.fun/v1/chat/completions"
};

const TEXT_MODEL = "deepseek-v3.2-exp";
const IMAGE_MODEL = "gemini-3.1-pro-preview";

async function callGeminiAPI(messages: any[], model: string, customConfig: any = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2分钟超时

  try {
    const response = await fetch(API_CONFIG.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.key}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        ...customConfig
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = `接口请求失败 (HTTP ${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) errorMsg = errorData.error.message;
      } catch(e) {}
      throw new Error(errorMsg);
    }

    return await response.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('请求超时，请重试。');
    }
    throw err;
  }
}

// 增强版图片提取函数：支持 Markdown、混合文本提取与报错拦截
function extractImageData(content: string | undefined | null) {
  if (!content) throw new Error("API 返回了空内容");

  // 1. 尝试提取 Markdown 格式的图片链接: ![alt](url)
  const markdownMatch = content.match(/!\[.*?\]\((.*?)\)/);
  if (markdownMatch && markdownMatch[1]) return markdownMatch[1];

  // 2. 尝试提取藏在废话文本中的普通 http/https 链接
  const httpMatch = content.match(/(https?:\/\/[^\s)"']+)/);
  if (httpMatch && httpMatch[1]) return httpMatch[1];

  // 3. 尝试提取标准的 data:image base64 字符串
  if (content.includes('data:image')) {
    const base64Match = content.match(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/);
    if (base64Match) return base64Match[0];
  }

  // 4. 如果内容特别长，且没有空格，那可能是纯粹的 base64 代码忘了加前缀
  const trimmed = content.trim();
  if (trimmed.length > 500 && !trimmed.includes(' ')) {
    return `data:image/png;base64,${trimmed}`;
  }

  // 5. 终极防御：如果啥也没匹配到，说明模型在这个接口下不支持生图，或者报错了
  console.error("图片解析失败，AI 的原始回复是：", content);
  throw new Error(`AI 未返回有效图片。它的原始回复是："${content.substring(0, 50)}..."`);
}

// 图片压缩工具函数：将大图压缩到合理尺寸，避免 base64 过大导致请求失败
function compressImage(base64Url: string, maxSize = 800, quality = 0.8): Promise<{ data: string; mimeType: string; url: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      // 等比缩放
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const data = dataUrl.split(',')[1];
      resolve({ data, mimeType: 'image/jpeg', url: dataUrl });
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = base64Url;
  });
}

const MOCKUP_TYPES = [
  "名片 (Business Card)", "纸杯 (Paper Cup)", "雨伞 (Umbrella)", 
  "T恤/服装 (T-Shirt)", "帽子 (Hat)", "便签 (Sticky Note)", 
  "户外招牌 (Outdoor Sign)", "室内招牌 (Indoor Sign)", "桌卡 (Table Card)", 
  "帆布袋 (Tote Bag)", "笔记本 (Notebook)", "信封 (Envelope)", 
  "包装盒 (Packaging Box)", "广告牌 (Billboard)", "手机壳 (Phone Case)"
];

interface ColorPalette {
  hex: string;
  meaning: string;
}

interface BrandProposal {
  explanation: string;
  dualMeaning: string;
  colors: ColorPalette[];
  guidelines: {
    minSize: string;
    forbidden: string[];
    incorrect: string[];
  };
  gridImageUrl: string;
}

interface SavedLogo {
  id: string;
  timestamp: number;
  prompt: string;
  selectedIdea: string;
  selectedLogo: string;
  brandProposal?: BrandProposal;
  mockups?: Record<string, string>;
}

export default function App() {
  const [view, setView] = useState<'workspace' | 'library'>('workspace');
  const [library, setLibrary] = useState<SavedLogo[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>("");

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [error, setError] = useState("");

  const [prompt, setPrompt] = useState("");
  const [referenceImg, setReferenceImg] = useState<{mimeType: string, data: string, url: string} | null>(null);

  const [optimizeMode, setOptimizeMode] = useState(false);
  const [optimizeImg, setOptimizeImg] = useState<{mimeType: string, data: string, url: string} | null>(null);
  const [optimizePrompt, setOptimizePrompt] = useState("");
  
  const optimizeInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directUploadRef = useRef<HTMLInputElement>(null); // 用于任意步骤直接上传

  const [ideas, setIdeas] = useState<string[]>([]);
  const [selectedIdea, setSelectedIdea] = useState("");
  const [ideaFeedback, setIdeaFeedback] = useState("");

  const [logos, setLogos] = useState<string[]>([]);
  const [selectedLogo, setSelectedLogo] = useState("");
  const [logoFeedback, setLogoFeedback] = useState("");

  const [brandProposal, setBrandProposal] = useState<BrandProposal | null>(null);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [mockups, setMockups] = useState<Record<string, string>>({});
  const [mockupFeedback, setMockupFeedback] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem('ai_logo_library');
    if (saved) {
      try { setLibrary(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('ai_logo_library', JSON.stringify(library));
  }, [library]);

  const saveToLibrary = (proposal?: BrandProposal, currentMockups?: Record<string, string>) => {
    const newLogo: SavedLogo = {
      id: currentProjectId || Date.now().toString(),
      timestamp: Date.now(),
      prompt: optimizeMode ? optimizePrompt : prompt,
      selectedIdea: optimizeMode ? "基于原图优化" : selectedIdea,
      selectedLogo,
      brandProposal: proposal || brandProposal || undefined,
      mockups: currentMockups || mockups
    };
    
    setLibrary(prev => {
      const exists = prev.findIndex(l => l.id === newLogo.id);
      if (exists >= 0) {
        const updated = [...prev];
        updated[exists] = newLogo;
        return updated;
      }
      return [newLogo, ...prev];
    });
    
    if (!currentProjectId) setCurrentProjectId(newLogo.id);
  };

  const loadProject = (project: SavedLogo) => {
    setCurrentProjectId(project.id);
    setPrompt(project.prompt);
    setSelectedIdea(project.selectedIdea);
    setSelectedLogo(project.selectedLogo);
    setBrandProposal(project.brandProposal || null);
    setMockups(project.mockups || {});
    setOptimizeMode(project.selectedIdea === "基于原图优化");
    
    if (project.mockups && Object.keys(project.mockups).length > 0) setStep(6);
    else if (project.brandProposal) setStep(4);
    else if (project.selectedLogo) setStep(3);
    else if (project.selectedIdea) setStep(2);
    else setStep(1);
    
    setView('workspace');
  };

  const startNewProject = () => {
    setCurrentProjectId("");
    setStep(1); 
    setPrompt(""); 
    setReferenceImg(null);
    setOptimizeMode(false);
    setOptimizeImg(null);
    setOptimizePrompt("");
    setIdeas([]); 
    setSelectedIdea(""); 
    setLogos([]); 
    setSelectedLogo("");
    setBrandProposal(null);
    setSelectedApps([]); 
    setMockups({});
    setView('workspace');
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, isOptimize = false) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const rawUrl = reader.result as string;
          // 压缩图片，避免 base64 过大导致 API 请求失败
          const compressed = await compressImage(rawUrl, 800, 0.7);
          if (isOptimize) {
            setOptimizeImg(compressed);
          } else {
            setReferenceImg(compressed);
          }
        } catch (err) {
          setError("图片处理失败，请尝试更小的图片。");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDirectUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        const url = `data:${file.type};base64,${base64String}`;
        setSelectedLogo(url);
        if (!selectedIdea) setSelectedIdea("用户独立上传的Logo文件"); 
        setBrandProposal(null);
        setMockups({});
      };
      reader.readAsDataURL(file);
    }
  };

  const downloadImage = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const generateIdeas = async (feedback = "") => {
    if (!prompt.trim() && !referenceImg) {
      setError("请至少填写设计需求或上传参考图片。");
      return;
    }
    setLoading(true);
    setError("");
    setLoadingText("深度思考中：使用 DeepSeek 生成创意方向...");

    try {
      const userMessage: any = {
        role: "user",
        content: [
          { type: "text", text: `作为顶尖品牌设计师。基于需求："${prompt}"，生成4个完全不同的Logo设计创意。${feedback ? `\n用户修改意见："${feedback}"。` : ''}严格返回JSON格式：{"ideas": ["创意1", "创意2", "创意3", "创意4"]}` }
        ]
      };

      if (referenceImg) {
        userMessage.content.push({
          type: "image_url",
          image_url: { url: `data:${referenceImg.mimeType};base64,${referenceImg.data}` }
        });
        userMessage.content[0].text += " (用户已提供参考图，请在创意中强调符合该图的核心视觉特征)";
      }

      const response = await callGeminiAPI([userMessage], TEXT_MODEL, {
        response_format: { type: "json_object" }
      });

      const parsed = JSON.parse(response.choices?.[0]?.message?.content || "{}");
      
      let generatedIdeas = ["极简几何重构方案", "负空间巧妙运用方案", "流体线条有机概念", "复古现代结合风格"];
      if (Array.isArray(parsed)) generatedIdeas = parsed;
      else if (Array.isArray(parsed.ideas)) generatedIdeas = parsed.ideas;
      else if (Object.values(parsed).find(Array.isArray)) generatedIdeas = Object.values(parsed).find(Array.isArray) as string[];

      setIdeas(generatedIdeas.slice(0, 4));
      setStep(2);
      setIdeaFeedback("");
    } catch (err: any) {
      setError(err.message || "生成想法失败，请重试。");
    } finally {
      setLoading(false);
    }
  };

  const generateLogos = async (feedback = "") => {
    if (!selectedIdea) return;
    setLoading(true);
    setError("");
    setLoadingText("视觉生成中：调用 Gemini 3.1 Pro 绘制 Logo...");

    try {
      const promises = [1, 2, 3].map(async (variationIndex) => {
        const imagePrompt = `A clean, professional minimalist logo design. Vector art style, flat colors, completely solid white background. Centered perfectly, 1:1 aspect ratio. Concept: ${selectedIdea}. ${feedback ? `User revision requirement: "${feedback}".` : ''} Variation ${variationIndex} for diversity.`;
        
        const response = await callGeminiAPI([{ role: "user", content: imagePrompt }], IMAGE_MODEL);
        return extractImageData(response.choices?.[0]?.message?.content);
      });

      const results = await Promise.all(promises);
      setLogos(results.filter(url => url !== ""));
      setStep(3);
      setLogoFeedback("");
    } catch (err: any) {
      setError("Logo生成过程中出现问题，请重试。");
    } finally {
      setLoading(false);
    }
  };

  const optimizeLogo = async (feedback = "") => {
    if (!optimizeImg) {
      setError("请上传需要优化的原 Logo 图片。");
      return;
    }
    setLoading(true);
    setError("");
    setLoadingText("重绘中：调用 Gemini 3.1 Pro 优化原图...");
    setOptimizeMode(true);
    setSelectedIdea("基于原图优化");

    try {
      const promises = [1, 2, 3].map(async (variationIndex) => {
        const currentFeedback = feedback || optimizePrompt;
        const imagePrompt = `Redesign and optimize this logo. A clean, professional minimalist logo design. Vector art style, flat colors, completely solid white background. Centered perfectly, 1:1 aspect ratio. ${currentFeedback ? `User optimization requirement: "${currentFeedback}".` : 'Make it look more modern and professional.'} Variation ${variationIndex} for diversity.`;
        
        try {
          // 方式一：发送图片+文字的多模态请求
          const response = await callGeminiAPI([
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${optimizeImg.mimeType};base64,${optimizeImg.data}` } },
                { type: "text", text: imagePrompt }
              ]
            }
          ], IMAGE_MODEL);

          return extractImageData(response.choices?.[0]?.message?.content);
        } catch (multimodalErr: any) {
          // 方式二：如果多模态失败，回退到纯文本描述方式
          console.warn("多模态请求失败，回退到纯文本模式：", multimodalErr.message);
          const fallbackPrompt = `${imagePrompt} The original logo features text and graphic elements that need to be redesigned while keeping the brand identity. Please generate a new version.`;
          const response = await callGeminiAPI([{ role: "user", content: fallbackPrompt }], IMAGE_MODEL);
          return extractImageData(response.choices?.[0]?.message?.content);
        }
      });

      const results = await Promise.all(promises);
      const validResults = results.filter(url => url !== "");
      if (validResults.length === 0) {
        throw new Error("未能生成任何有效的 Logo 图片");
      }
      setLogos(validResults);
      setStep(3);
      setLogoFeedback("");
    } catch (err: any) {
      setError("Logo优化过程中出现问题：" + (err.message || "请重试。"));
    } finally {
      setLoading(false);
    }
  };

  const generateProposal = async () => {
    if (!selectedLogo) return;
    setLoading(true);
    setError("");
    setLoadingText("品牌构建中：深度分析与制图同步进行...");

    try {
      const conceptText = optimizeMode ? `基于原图优化的Logo，优化需求：${optimizePrompt}` : selectedIdea;
      const textPrompt = `你是一位顶尖的品牌战略专家。请基于这个核心创意方向，撰写极具专业感和商业价值的品牌提案。\n\n创意方向：${conceptText}\n\n请严格返回 JSON 格式，必须包含以下结构（不要遗漏）：\n{"explanation":"详细解释该视觉元素的专业性与品牌理念","dualMeaning":"阐述图形设计中巧妙的双层或多层隐藏涵义","colors":[{"hex":"#主色HEX","meaning":"主色情感与商业应用"},{"hex":"#辅助色HEX","meaning":"辅助色调和作用"}],"guidelines":{"minSize":"如15mm","forbidden":["禁止随意拉伸","禁止更改比例"],"incorrect":["错误底色应用","侵入安全空间"]}}`;
      
      const textRes = await callGeminiAPI([{ role: "user", content: textPrompt }], TEXT_MODEL, {
        response_format: { type: "json_object" }
      });
      
      let proposalData: any = {};
      try {
        proposalData = JSON.parse(textRes.choices?.[0]?.message?.content || "{}");
      } catch (e) {}

      // 防白屏：如果 DeepSeek 返回格式缺失，强制垫入默认数据
      const finalProposalData: BrandProposal = {
        explanation: proposalData.explanation || "该标志以极简的设计语言提炼了品牌核心理念，展现了专业、现代的视觉形象。",
        dualMeaning: proposalData.dualMeaning || "图形既传达了行业的专属性，又在负空间或线条交织中隐喻了品牌与用户的紧密连接。",
        colors: Array.isArray(proposalData.colors) && proposalData.colors.length > 0 ? proposalData.colors : [{ hex: "#1A365D", meaning: "深邃严谨的品牌主基调" }, { hex: "#E2E8F0", meaning: "现代科技感的辅助基底" }],
        guidelines: {
          minSize: proposalData.guidelines?.minSize || "15mm / 50px",
          forbidden: Array.isArray(proposalData.guidelines?.forbidden) ? proposalData.guidelines.forbidden : ["禁止随意改变图形的原始长宽比例", "禁止在无对比度的复杂背景上使用"],
          incorrect: Array.isArray(proposalData.guidelines?.incorrect) ? proposalData.guidelines.incorrect : ["渐变色滥用破坏扁平化质感", "元素间距错误缩放侵占安全空间"]
        },
        gridImageUrl: ""
      };

      // 制图：强行将选中的 Logo 发给 Gemini 照着画
      const imagePrompt = `A highly professional architectural blueprint, geometric construction lines, drafting grid, golden ratio circles, wireframe of a minimalist logo. Technical drawing style, clean white background, precise measurements, black and white lines. Concept: ${conceptText}. TRACING THE EXACT SHAPE OF THE PROVIDED LOGO IN THE IMAGE URL.`;
      
      const imgRes = await callGeminiAPI([
        {
          role: "user",
          content: [
            { type: "text", text: imagePrompt },
            { type: "image_url", image_url: { url: selectedLogo } }
          ]
        }
      ], IMAGE_MODEL);
      
      finalProposalData.gridImageUrl = extractImageData(imgRes.choices?.[0]?.message?.content);

      setBrandProposal(finalProposalData);
      saveToLibrary(finalProposalData);
      setStep(4);
    } catch (err: any) {
      setError("生成提案失败：" + err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateMockups = async (feedback = "") => {
    if (selectedApps.length === 0) {
      setError("请至少选择一个应用场景。");
      return;
    }
    setLoading(true);
    setError("");
    setLoadingText(`渲染中：Gemini 正在为您渲染 ${selectedApps.length} 张效果图...`);

    try {
      const newMockups = { ...mockups };
      
      const promises = selectedApps.map(async (appType) => {
        const imagePrompt = `A hyper-realistic, high-resolution photo mockup of a ${appType.split('(')[1].replace(')','')} featuring this logo perfectly placed on it. ${feedback ? `User styling feedback: "${feedback}".` : ''} Professional studio lighting, commercial product photography, depth of field, elegant presentation.`;
        
        const response = await callGeminiAPI([
          {
            role: "user",
            content: [
              { type: "text", text: imagePrompt },
              { type: "image_url", image_url: { url: selectedLogo } }
            ]
          }
        ], IMAGE_MODEL);

        const imgData = extractImageData(response.choices?.[0]?.message?.content);
        if(imgData) {
          newMockups[appType] = imgData;
        }
      });

      await Promise.all(promises);
      setMockups(newMockups);
      saveToLibrary(brandProposal || undefined, newMockups);
      setStep(6);
      setMockupFeedback("");
    } catch (err: any) {
      setError("场景渲染失败，请重试或减少单次生成的数量。");
    } finally {
      setLoading(false);
    }
  };
// 【核心交互解耦】进度条现在是可点击的，允许用户跳跃操作
  const renderStepper = () => {
    const steps = ["需求输入", "创意选择", "Logo筛选", "品牌提案", "场景应用", "效果导出"];
    return (
      <div className="flex items-center justify-between mb-8 overflow-x-auto pb-4">
        {steps.map((s, idx) => {
          const sNum = idx + 1;
          const isActive = step === sNum;
          const isPast = step > sNum;
          return (
            <div 
              key={idx} 
              // 加上 cursor-pointer 允许直接点击跳转
              className="flex items-center min-w-max cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setStep(sNum)}
            >
              <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 font-semibold text-sm transition-colors
                ${isActive ? 'border-indigo-600 bg-indigo-600 text-white shadow-md' : 
                  isPast ? 'border-indigo-600 bg-indigo-50 text-indigo-600' : 'border-slate-300 text-slate-400'}`}>
                {isPast ? <CheckCircle2 size={16} /> : sNum}
              </div>
              <span className={`ml-2 font-medium text-sm ${isActive ? 'text-indigo-900' : isPast ? 'text-indigo-600' : 'text-slate-400'}`}>
                {s}
              </span>
              {idx < steps.length - 1 && (
                <div className={`w-8 sm:w-16 h-[2px] mx-2 sm:mx-4 ${isPast ? 'bg-indigo-600' : 'bg-slate-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // 【新增 UI 组件】全能 Target Logo 控制面板，用于 3,4,5,6 步，处理直接跳步时缺少 Logo 的情况
  const renderLogoRequirement = () => (
    <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm gap-4">
      <div className="flex items-center gap-3">
         {selectedLogo ? (
           <img src={selectedLogo} className="w-12 h-12 object-contain bg-white rounded-lg shadow-sm border border-slate-200" alt="Current" />
         ) : (
           <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center border border-slate-200 border-dashed">
             <ImageIcon size={20} className="text-slate-300"/>
           </div>
         )}
         <div>
           <p className="text-sm font-bold text-slate-800">{selectedLogo ? "当前已就绪的 Logo" : "您当前尚未选择 Logo"}</p>
           <p className="text-xs text-slate-500">{selectedLogo ? "您可以直接继续本步骤的操作" : "本步骤需要依赖图像，请上传或选择"}</p>
         </div>
      </div>
      <div className="flex gap-2">
        <input type="file" accept="image/*" className="hidden" ref={directUploadRef} onChange={handleDirectUpload} />
        <button 
          onClick={() => setView('library')} 
          className="px-4 py-2 bg-white text-indigo-600 text-xs sm:text-sm font-bold rounded-lg shadow-sm border border-indigo-200 hover:bg-indigo-50 transition-colors"
        >
          从库中加载
        </button>
        <button 
          onClick={() => directUploadRef.current?.click()} 
          className="px-4 py-2 bg-indigo-600 text-white text-xs sm:text-sm font-bold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors"
        >
          {selectedLogo ? "替换图片" : "本地上传图片"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-200">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600 cursor-pointer" onClick={startNewProject}>
            <Sparkles className="w-6 h-6" />
            <h1 className="text-xl font-bold tracking-tight">AI Logo 智能工坊</h1>
          </div>
          <div className="flex items-center gap-4">
            {view === 'workspace' && step > 1 && (
              <button 
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft size={16} />
                返回上一步
              </button>
            )}
            <div className="h-6 w-px bg-slate-200 mx-2"></div>
            <button 
              onClick={() => setView(view === 'workspace' ? 'library' : 'workspace')}
              className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                view === 'library' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Library size={18} />
              我的Logo库
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
            <p className="text-lg font-medium text-slate-800 animate-pulse">{loadingText}</p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 flex items-start gap-3">
            <div className="mt-0.5">⚠️</div>
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {view === 'library' ? (
          <div className="animate-in fade-in duration-500">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-3xl font-bold text-slate-900">我的 Logo 库</h2>
                <p className="text-slate-500 mt-2">管理和查看您之前生成的所有 Logo 项目。</p>
              </div>
              <button 
                onClick={startNewProject}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
              >
                <Plus size={18} /> 新建设计
              </button>
            </div>

            {library.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                <Library size={48} className="mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">您的库还是空的</h3>
                <p className="text-slate-500 mb-6">快去创建一个属于您的专属 Logo 吧！</p>
                <button 
                  onClick={startNewProject}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
                >
                  去设计
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {library.map((project) => (
                  <div 
                    key={project.id} 
                    onClick={() => loadProject(project)}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer group"
                  >
                    <div className="aspect-square bg-slate-50 relative border-b border-slate-100">
                      {project.selectedLogo ? (
                        <img src={project.selectedLogo} alt="Logo" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                          <Sparkles size={48} />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-indigo-900/0 group-hover:bg-indigo-900/10 transition-colors flex items-center justify-center">
                        <span className="opacity-0 group-hover:opacity-100 bg-white text-indigo-600 px-4 py-2 rounded-full font-medium shadow-sm transform translate-y-2 group-hover:translate-y-0 transition-all">
                          继续编辑
                        </span>
                      </div>
                    </div>
                    <div className="p-5">
                      <p className="text-xs text-slate-400 mb-2">
                        {new Date(project.timestamp).toLocaleString()}
                      </p>
                      <p className="text-sm font-medium text-slate-800 line-clamp-2">
                        {project.prompt || "未命名设计项目"}
                      </p>
                      <div className="mt-4 flex gap-2">
                        {project.brandProposal && <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded">含提案</span>}
                        {project.mockups && Object.keys(project.mockups).length > 0 && <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded">含效果图</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {renderStepper()}
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-6 sm:p-8 relative overflow-hidden">
              
              {step === 1 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">步骤 1：开启您的设计之旅</h2>
                    <p className="text-slate-500">您可以选择从零开始生成全新创意，或者上传已有 Logo 进行优化重绘。</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Option A: Create from scratch */}
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                      <div className="flex items-center gap-2 text-indigo-600 mb-2">
                        <Sparkles size={20} />
                        <h3 className="font-bold text-lg">全新创意生成</h3>
                      </div>
                      <p className="text-sm text-slate-500">输入品牌名称和风格需求，AI为您构思4个不同的方向。</p>
                      
                      <div className="space-y-3">
                        <label className="block text-sm font-semibold text-slate-700">需求描述</label>
                        <textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="例如：我需要一个咖啡馆的Logo，名字叫 'Morning Brew'，风格偏极简、现代..."
                          className="w-full h-28 p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all resize-none text-sm"
                        />
                      </div>

                      <div className="space-y-3">
                        <label className="block text-sm font-semibold text-slate-700">参考图片 (可选)</label>
                        <div 
                          className={`border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer hover:bg-slate-100 ${referenceImg ? 'border-indigo-400 bg-indigo-50/30' : 'border-slate-300 bg-white'}`}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            ref={fileInputRef}
                            onChange={(e) => handleImageUpload(e, false)}
                          />
                          {referenceImg ? (
                            <div className="flex flex-col items-center gap-2">
                              <img src={referenceImg.url} alt="参考" className="h-16 object-contain rounded-lg shadow-sm" />
                              <span className="text-xs text-indigo-600 font-medium">点击重新上传</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1 text-slate-500">
                              <Upload size={20} className="text-slate-400 mb-1" />
                              <p className="text-sm font-medium">点击上传参考图</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <button 
                        onClick={() => generateIdeas()}
                        className="w-full py-3 bg-indigo-600 text-white rounded-xl font-medium shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                      >
                        <Sparkles size={18} />
                        开始生成创意
                      </button>
                    </div>

                    {/* Option B: Optimize existing logo */}
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
                      <div className="flex items-center gap-2 text-emerald-600 mb-2">
                        <Edit3 size={20} />
                        <h3 className="font-bold text-lg">基于原图优化</h3>
                      </div>
                      <p className="text-sm text-slate-500">上传您已有的 Logo 或草图，输入修改意见，直接生成优化后的 3 款方案。</p>
                      
                      <div className="space-y-3">
                        <label className="block text-sm font-semibold text-slate-700">上传原图 (必填)</label>
                        <div 
                          className={`border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer hover:bg-slate-100 ${optimizeImg ? 'border-emerald-400 bg-emerald-50/30' : 'border-slate-300 bg-white'}`}
                          onClick={() => optimizeInputRef.current?.click()}
                        >
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            ref={optimizeInputRef}
                            onChange={(e) => handleImageUpload(e, true)}
                          />
                          {optimizeImg ? (
                            <div className="flex flex-col items-center gap-2">
                              <img src={optimizeImg.url} alt="原图" className="h-16 object-contain rounded-lg shadow-sm" />
                              <span className="text-xs text-emerald-600 font-medium">点击重新上传</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1 text-slate-500">
                              <Upload size={20} className="text-slate-400 mb-1" />
                              <p className="text-sm font-medium">点击上传原 Logo</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="block text-sm font-semibold text-slate-700">优化需求描述</label>
                        <textarea
                          value={optimizePrompt}
                          onChange={(e) => setOptimizePrompt(e.target.value)}
                          placeholder="例如：让线条更流畅，颜色换成科技蓝，整体更具现代感..."
                          className="w-full h-28 p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none text-sm"
                        />
                      </div>

                      <button 
                        onClick={() => optimizeLogo()}
                        disabled={!optimizeImg}
                        className={`w-full py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2
                          ${optimizeImg 
                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200 hover:bg-emerald-700' 
                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                      >
                        <Edit3 size={18} />
                        直接优化重绘
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">步骤 2：选择一个创意方向</h2>
                    <p className="text-slate-500">AI 为您构思了 4 个不同的方向。点击选择您最喜欢的一个，或者在下方提出修改意见重新生成。</p>
                  </div>

                  {ideas.length === 0 ? (
                    <div className="text-center py-16 text-slate-500">
                      <p>请先在 <button onClick={()=>setStep(1)} className="text-indigo-600 font-bold underline">步骤 1</button> 输入您的需求以生成创意。</p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {ideas.map((idea, idx) => (
                          <div 
                            key={idx}
                            onClick={() => setSelectedIdea(idea)}
                            className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                              selectedIdea === idea 
                                ? 'border-indigo-600 bg-indigo-50/50 shadow-md' 
                                : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="inline-block px-2.5 py-1 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-md">
                                方案 0{idx + 1}
                              </span>
                              {selectedIdea === idea && <CheckCircle2 className="text-indigo-600" size={20} />}
                            </div>
                            <p className="text-sm text-slate-700 leading-relaxed mt-3">{idea}</p>
                          </div>
                        ))}
                      </div>

                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700">
                            <MessageSquare size={16} />
                            <span>不满意？提出反馈</span>
                          </div>
                          <input 
                            type="text" 
                            value={ideaFeedback}
                            onChange={(e) => setIdeaFeedback(e.target.value)}
                            placeholder="例如：方案太复杂了，希望更极简一点..."
                            className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                          />
                        </div>
                        <div className="flex items-end sm:pb-[2px]">
                          <button 
                            onClick={() => generateIdeas(ideaFeedback)}
                            className="w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                          >
                            <RefreshCw size={16} />
                            重新生成想法
                          </button>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end">
                        <button 
                          disabled={!selectedIdea}
                          onClick={() => generateLogos()}
                          className={`px-8 py-3.5 rounded-xl font-medium transition-all flex items-center gap-2
                            ${selectedIdea 
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 hover:bg-indigo-700' 
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                        >
                          下一步：生成 Logo 图 <ChevronRight size={18} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">步骤 3：挑选 Logo 草图</h2>
                    <p className="text-slate-500">
                      {optimizeMode ? "基于您的原图和反馈，我们优化了 3 款 1:1 画幅的 Logo。" : "基于您选择的创意，我们生成了 3 款 1:1 画幅的 Logo。"}
                      选中最满意的一个，您可以随时保存图片。
                    </p>
                  </div>

                  {/* 这里插入跳步安全面板 */}
                  {renderLogoRequirement()}

                  {logos.length === 0 && selectedLogo ? (
                     <div className="text-center py-10 bg-slate-50 rounded-xl border border-slate-200">
                        <h3 className="text-lg font-bold text-slate-800 mb-2">图片已加载完成</h3>
                        <p className="text-slate-500 mb-4">您可以直接跳过本步骤进行后续操作。</p>
                        <div className="flex justify-center gap-4">
                          <button onClick={() => setStep(4)} className="px-6 py-2 bg-indigo-100 text-indigo-700 font-bold rounded-lg hover:bg-indigo-200 transition-colors">撰写品牌提案</button>
                          <button onClick={() => setStep(5)} className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors">应用场景效果图</button>
                        </div>
                     </div>
                  ) : logos.length > 0 ? (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        {logos.map((logoUrl, idx) => (
                          <div key={idx} className="group relative">
                            <div 
                              onClick={() => setSelectedLogo(logoUrl)}
                              className={`relative aspect-square rounded-2xl overflow-hidden border-4 cursor-pointer transition-all ${
                                selectedLogo === logoUrl ? 'border-indigo-600 shadow-xl' : 'border-slate-100 hover:border-indigo-300'
                              }`}
                            >
                              <img src={logoUrl} alt={`Logo ${idx+1}`} className="w-full h-full object-cover" />
                              {selectedLogo === logoUrl && (
                                <div className="absolute top-3 right-3 bg-white rounded-full p-1 shadow-md">
                                  <CheckCircle2 className="text-indigo-600" size={24} />
                                </div>
                              )}
                            </div>
                            <button 
                              onClick={(e) => { e.stopPropagation(); downloadImage(logoUrl, `Logo-Design-${idx+1}.png`); }}
                              className="absolute bottom-3 left-3 bg-white/90 backdrop-blur text-slate-700 p-2 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-1 text-xs font-semibold"
                            >
                              <Download size={14} /> 保存图片
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700">
                            <MessageSquare size={16} />
                            <span>有修改意见？</span>
                          </div>
                          <input 
                            type="text" 
                            value={logoFeedback}
                            onChange={(e) => setLogoFeedback(e.target.value)}
                            placeholder="例如：颜色换成深蓝色，字体更大一些..."
                            className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                          />
                        </div>
                        <div className="flex items-end sm:pb-[2px]">
                          <button 
                            onClick={() => optimizeMode ? optimizeLogo(logoFeedback) : generateLogos(logoFeedback)}
                            className="w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                          >
                            <RefreshCw size={16} />
                            重新生成 Logo
                          </button>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end">
                        <button 
                          disabled={!selectedLogo}
                          onClick={() => generateProposal()}
                          className={`px-8 py-3.5 rounded-xl font-medium transition-all flex items-center gap-2
                            ${selectedLogo 
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 hover:bg-indigo-700' 
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                        >
                          下一步：生成品牌提案 <ChevronRight size={18} />
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {step === 4 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex justify-between items-end mb-4">
                    <div>
                      <h2 className="text-2xl font-bold mb-2">步骤 4：品牌提案与规范</h2>
                      <p className="text-slate-500">为您量身定制的品牌释义、色彩规范及标准化制图。</p>
                    </div>
                    {brandProposal && (
                      <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full flex items-center gap-1">
                        <CheckCircle2 size={14} /> 已存入Logo库
                      </span>
                    )}
                  </div>

                  {/* 跳步安全面板 */}
                  {renderLogoRequirement()}

                  {/* 如果跳转到这步，有Logo但还没生成提案，显示一键生成按钮 */}
                  {!brandProposal && selectedLogo && (
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-10 text-center shadow-sm">
                       <BookOpen size={40} className="mx-auto text-indigo-300 mb-4" />
                       <h3 className="text-xl font-bold text-slate-800 mb-2">为当前 Logo 撰写专业提案</h3>
                       <p className="text-slate-500 mb-6">我们将由 AI 深度分析该视觉元素，并为您输出结构化的品牌释义、色彩规范与几何线稿。</p>
                       <button 
                         onClick={generateProposal} 
                         className="px-8 py-3.5 bg-indigo-600 text-white rounded-xl font-medium shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-all inline-flex items-center gap-2"
                       >
                         开始生成品牌提案 <Sparkles size={18} />
                       </button>
                    </div>
                  )}

                  {/* 正常展示提案内容 */}
                  {brandProposal && (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Left Column: Images */}
                        <div className="space-y-6">
                          <div className="bg-slate-50 p-2 rounded-2xl border border-slate-200">
                            <img src={selectedLogo} alt="Final Logo" className="w-full aspect-square object-cover rounded-xl shadow-sm" />
                            <p className="text-center text-sm font-medium text-slate-500 mt-3 mb-1">最终确认 Logo</p>
                          </div>
                          
                          {brandProposal.gridImageUrl && (
                            <div className="bg-slate-50 p-2 rounded-2xl border border-slate-200 relative group">
                              <img src={brandProposal.gridImageUrl} alt="Grid" className="w-full aspect-square object-cover rounded-xl shadow-sm" />
                              <button 
                                onClick={() => downloadImage(brandProposal.gridImageUrl, 'Logo-Grid-Lines.png')}
                                className="absolute bottom-4 right-4 bg-white/90 backdrop-blur text-slate-700 p-2 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-1 text-xs font-semibold"
                              >
                                <Download size={14} /> 下载线稿图
                              </button>
                              <p className="text-center text-sm font-medium text-slate-500 mt-3 mb-1 flex items-center justify-center gap-1">
                                <Ruler size={14} /> 标准化几何线稿原理图
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Right Column: Text Proposal */}
                        <div className="space-y-6">
                          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                              <BookOpen size={20} className="text-indigo-600" /> 品牌创意说明
                            </h3>
                            <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
                              <div>
                                <strong className="text-slate-800 block mb-1">设计理念：</strong>
                                <p>{brandProposal.explanation}</p>
                              </div>
                              <div>
                                <strong className="text-slate-800 block mb-1">双层涵义：</strong>
                                <p>{brandProposal.dualMeaning}</p>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                              <Palette size={20} className="text-indigo-600" /> 标准配色规范
                            </h3>
                            
                            {/* 色彩实际应用展示区块，增加判断防止 map 报错 */}
                            {brandProposal.colors && brandProposal.colors.length > 0 && (
                              <div className="flex h-12 rounded-lg overflow-hidden mb-4 shadow-inner border border-slate-200">
                                {brandProposal.colors.map((color, idx) => (
                                  <div 
                                    key={idx} 
                                    className={`transition-all ${idx === 0 ? 'w-1/2' : 'flex-1'}`}
                                    style={{ backgroundColor: color.hex }}
                                    title={color.meaning}
                                  />
                                ))}
                              </div>
                            )}

                            <div className="space-y-4">
                              {brandProposal.colors?.map((color, idx) => (
                                <div key={idx} className="flex items-start gap-4">
                                  <div 
                                    className="w-12 h-12 rounded-lg shadow-inner border border-slate-200 shrink-0"
                                    style={{ backgroundColor: color.hex }}
                                  />
                                  <div>
                                    <p className="font-mono text-sm font-bold text-slate-800">{color.hex}</p>
                                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{color.meaning}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                              <FileText size={20} className="text-indigo-600" /> 标准应用规范
                            </h3>
                            <div className="space-y-4 text-sm">
                              <div>
                                <strong className="text-slate-800 flex items-center gap-1 mb-1">
                                  <Ruler size={14} /> 最小尺寸限制
                                </strong>
                                <p className="text-slate-600">{brandProposal.guidelines?.minSize}</p>
                              </div>
                              <div>
                                <strong className="text-slate-800 flex items-center gap-1 mb-1">
                                  <AlertTriangle size={14} className="text-amber-500" /> 禁用场景
                                </strong>
                                <ul className="list-disc list-inside text-slate-600 space-y-1">
                                  {brandProposal.guidelines?.forbidden?.map((item, i) => <li key={i}>{item}</li>)}
                                </ul>
                              </div>
                              <div>
                                <strong className="text-slate-800 flex items-center gap-1 mb-1">
                                  <XCircle size={14} className="text-red-500" /> 错误使用示例
                                </strong>
                                <ul className="list-disc list-inside text-slate-600 space-y-1">
                                  {brandProposal.guidelines?.incorrect?.map((item, i) => <li key={i}>{item}</li>)}
                                </ul>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end">
                        <button 
                          onClick={() => setStep(5)}
                          className="px-8 py-3.5 bg-indigo-600 text-white rounded-xl font-medium shadow-md shadow-indigo-200 hover:bg-indigo-700 hover:shadow-lg transition-all flex items-center gap-2"
                        >
                          下一步：选择应用场景 <ChevronRight size={18} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 5 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">步骤 5：选择常规应用场景</h2>
                    <p className="text-slate-500">选择您希望将 Logo 应用在哪些实体物品上，AI将为您生成逼真的效果图。</p>
                  </div>

                  {renderLogoRequirement()}

                  {selectedLogo && (
                    <>
                      <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                            <LayoutGrid size={18} /> 可选场景 (15种)
                          </h3>
                          <span className="text-sm font-medium text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
                            已选: {selectedApps.length}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                          {MOCKUP_TYPES.map((appType) => {
                            const isSelected = selectedApps.includes(appType);
                            return (
                              <div 
                                key={appType}
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedApps(selectedApps.filter(a => a !== appType));
                                  } else {
                                    setSelectedApps([...selectedApps, appType]);
                                  }
                                }}
                                className={`p-3 rounded-lg border text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 h-20 select-none
                                  ${isSelected 
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' 
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-slate-50'
                                  }`}
                              >
                                <span className="text-sm font-medium leading-tight">
                                  {appType.split(' ')[0]}
                                </span>
                                {isSelected && <CheckCircle2 size={16} className="text-white/80" />}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="pt-4 flex justify-between items-center">
                        <button 
                          onClick={() => downloadImage(selectedLogo, 'Final-Logo.png')}
                          className="px-5 py-2.5 text-indigo-600 font-medium hover:bg-indigo-50 rounded-lg flex items-center gap-2 transition-colors"
                        >
                          <Download size={18} /> 直接下载当前Logo
                        </button>
                        <button 
                          disabled={selectedApps.length === 0}
                          onClick={() => generateMockups()}
                          className={`px-8 py-3.5 rounded-xl font-medium transition-all flex items-center gap-2
                            ${selectedApps.length > 0 
                              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 hover:bg-indigo-700' 
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                        >
                          生成场景效果图 <Sparkles size={18} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 6 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div>
                    <h2 className="text-2xl font-bold mb-2">步骤 6：您的品牌应用大片</h2>
                    <p className="text-slate-500">您的设计已经栩栩如生地呈现在实体应用上！您可以在此预览并下载所有高清效果图。</p>
                  </div>

                  {renderLogoRequirement()}

                  {Object.keys(mockups).length === 0 ? (
                    <div className="text-center py-16 text-slate-500">
                      尚无生成的效果图，请返回 <button onClick={()=>setStep(5)} className="text-indigo-600 font-bold underline">步骤 5</button> 选择并生成。
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {Object.entries(mockups).map(([appName, imgUrl], idx) => {
                          if (!imgUrl) return null;
                          return (
                            <div key={idx} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm group">
                              <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                                <img src={imgUrl} alt={appName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-4">
                                   <span className="text-white font-medium">{appName.split(' ')[0]}</span>
                                   <button 
                                      onClick={() => downloadImage(imgUrl, `${appName}-mockup.png`)}
                                      className="bg-white text-slate-900 p-2 rounded-full hover:bg-indigo-50 hover:text-indigo-600 transition-colors shadow-lg"
                                      title="下载效果图"
                                    >
                                      <Download size={18} />
                                    </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700">
                            <MessageSquare size={16} />
                            <span>需要调整场景风格？</span>
                          </div>
                          <input 
                            type="text" 
                            value={mockupFeedback}
                            onChange={(e) => setMockupFeedback(e.target.value)}
                            placeholder="例如：背景换成深色调的桌面，或者室外阳光下的场景..."
                            className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                          />
                        </div>
                        <div className="flex items-end sm:pb-[2px]">
                          <button 
                            onClick={() => generateMockups(mockupFeedback)}
                            className="w-full sm:w-auto px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                          >
                            <RefreshCw size={16} />
                            应用反馈并重绘场景
                          </button>
                        </div>
                      </div>

                      <div className="pt-8 border-t border-slate-200 flex flex-col items-center justify-center">
                        <p className="text-slate-500 mb-4">设计完成！您的品牌已经准备好走向世界。</p>
                        <button 
                          onClick={startNewProject}
                          className="px-6 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors flex items-center gap-2 shadow-md"
                        >
                          <Sparkles size={16} /> 开始全新的设计
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

            </div>
          </>
        )}
      </main>
    </div>
  );
}
