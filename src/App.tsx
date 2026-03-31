import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, X, Download, Bookmark, Plus, Sparkles, ImageIcon, Check } from 'lucide-react';
import OpenAI from 'openai';

// Types
type GeneratedImage = {
  id: string;
  url: string;
  base64: string;
  mimeType: string;
};

type GenerationGroup = {
  id: string;
  prompt: string;
  aspectRatio: string;
  images: GeneratedImage[];
  timestamp: number;
  parentId?: string;
};

type SavedImage = GeneratedImage & {
  savedAt: number;
};

// Initialize OpenAI client
const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || 'https://ai.scd666.com/v1',
  apiKey: process.env.OPENAI_API_KEY || 'sk-12a7BPJym4RJSfqoVq5EHEEAs4ohQjIAZOA8QWVMNmFA0Fru',
  dangerouslyAllowBrowser: true,
});

// Helpers
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
};

const getAspectRatioClass = (ratio: string) => {
  switch(ratio) {
    case '1:1': return 'aspect-square';
    case '4:3': return 'aspect-[4/3]';
    case '3:4': return 'aspect-[3/4]';
    case '16:9': return 'aspect-video';
    case '9:16': return 'aspect-[9/16]';
    default: return 'aspect-square';
  }
};

const getImageSize = (ratio: string): '1024x1024' | '1792x1024' | '1024x1792' => {
  switch(ratio) {
    case '1:1': return '1024x1024';
    case '4:3': return '1792x1024';
    case '3:4': return '1024x1792';
    case '16:9': return '1792x1024';
    case '9:16': return '1024x1792';
    default: return '1024x1024';
  }
};

// Components
function SegmentedControl({ options, value, onChange }: { options: any[], value: any, onChange: (v: any) => void }) {
  return (
    <div className="flex bg-gray-100/80 p-1 rounded-xl">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
            value === opt ? 'bg-white text-black shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean, onChange: (v: boolean) => void, label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 transition-colors">{label}</span>
      <div className={`relative w-11 h-6 rounded-full transition-colors duration-300 ${checked ? 'bg-[#34C759]' : 'bg-gray-200'}`}>
        <div className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-300 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
      <input type="checkbox" className="hidden" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

export default function App() {
  // State
  const [activeTab, setActiveTab] = useState<'workspace' | 'saved'>('workspace');
  
  const [productImage, setProductImage] = useState<{base64: string, mimeType: string} | null>(null);
  const [styleImages, setStyleImages] = useState<{base64: string, mimeType: string}[]>([]);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [style, setStyle] = useState('None');
  const [count, setCount] = useState(1);
  const [hasText, setHasText] = useState(false);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [generations, setGenerations] = useState<GenerationGroup[]>([]);
  const [savedImages, setSavedImages] = useState<SavedImage[]>([]);
  
  const [iteratingImage, setIteratingImage] = useState<string | null>(null);
  const [iterateFeedback, setIterateFeedback] = useState('');
  const [iterateCount, setIterateCount] = useState(1);
  const [isIterating, setIsIterating] = useState(false);

  // Handlers
  const handleProductUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const base64 = await fileToBase64(file);
      setProductImage({ base64, mimeType: file.type });
    }
  };

  const handleStyleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const newImages = await Promise.all(files.map(async file => ({
        base64: await fileToBase64(file),
        mimeType: file.type
      })));
      setStyleImages(prev => [...prev, ...newImages]);
    }
  };

  const generateImages = async () => {
    if (!prompt) return;
    
    try {
      setError(null);
      setIsGenerating(true);
      
      let fullPrompt = prompt;
      if (style !== 'None') fullPrompt += `. Style: ${style}.`;
      if (hasText) fullPrompt += `. Include elegant typography or text as appropriate.`;
      else fullPrompt += `. Do NOT include any text, words, or typography in the image.`;

      // Add context from uploaded images
      if (productImage) {
        fullPrompt = `Product image provided as reference. ${fullPrompt}`;
      }
      if (styleImages.length > 0) {
        fullPrompt = `Style reference images provided. ${fullPrompt}`;
      }

      const size = getImageSize(aspectRatio);
      
      const promises = Array.from({ length: count }).map(async () => {
        const response = await openai.images.generate({
          model: 'gpt-image-1',
          prompt: fullPrompt,
          n: 1,
          size: size,
          response_format: 'b64_json',
        });
        return response;
      });

      const responses = await Promise.all(promises);
      
      const newImages: GeneratedImage[] = [];
      responses.forEach(response => {
        if (response.data && response.data[0]) {
          const imageData = response.data[0];
          if (imageData.b64_json) {
            const id = Math.random().toString(36).substring(7);
            newImages.push({
              id,
              base64: imageData.b64_json,
              mimeType: 'image/png',
              url: `data:image/png;base64,${imageData.b64_json}`
            });
          }
        }
      });
      
      if (newImages.length > 0) {
        setGenerations(prev => [{
          id: Math.random().toString(36).substring(7),
          prompt: fullPrompt,
          aspectRatio,
          images: newImages,
          timestamp: Date.now()
        }, ...prev]);
        setActiveTab('workspace');
      }
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate images.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleIterate = async (sourceImage: GeneratedImage, group: GenerationGroup) => {
    if (!iterateFeedback) return;
    
    try {
      setIsIterating(true);
      
      const editPrompt = `Based on the previous image, make the following changes: ${iterateFeedback}`;
      const size = getImageSize(group.aspectRatio);

      const promises = Array.from({ length: iterateCount }).map(async () => {
        const response = await openai.images.generate({
          model: 'gpt-image-1',
          prompt: editPrompt,
          n: 1,
          size: size,
          response_format: 'b64_json',
        });
        return response;
      });

      const responses = await Promise.all(promises);
      
      const newImages: GeneratedImage[] = [];
      responses.forEach(response => {
        if (response.data && response.data[0]) {
          const imageData = response.data[0];
          if (imageData.b64_json) {
            const id = Math.random().toString(36).substring(7);
            newImages.push({
              id,
              base64: imageData.b64_json,
              mimeType: 'image/png',
              url: `data:image/png;base64,${imageData.b64_json}`
            });
          }
        }
      });
      
      if (newImages.length > 0) {
        setGenerations(prev => [{
          id: Math.random().toString(36).substring(7),
          prompt: `Refinement: ${iterateFeedback}`,
          aspectRatio: group.aspectRatio,
          images: newImages,
          timestamp: Date.now(),
          parentId: sourceImage.id
        }, ...prev]);
        setIteratingImage(null);
        setIterateFeedback('');
      }
      
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to iterate image.');
    } finally {
      setIsIterating(false);
    }
  };

  const saveImage = (image: GeneratedImage) => {
    if (!savedImages.find(s => s.id === image.id)) {
      setSavedImages(prev => [{ ...image, savedAt: Date.now() }, ...prev]);
    }
  };

  const downloadImage = (image: GeneratedImage) => {
    const a = document.createElement('a');
    a.href = image.url;
    a.download = `lumina-${image.id}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex h-screen bg-[#F5F5F7] text-[#1D1D1F] font-sans selection:bg-blue-200 overflow-hidden">
      {/* Sidebar */}
      <div className="w-[340px] bg-white/80 backdrop-blur-2xl border-r border-gray-200/50 flex flex-col h-full shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-20 shrink-0">
        <div className="p-6 pb-4">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-gray-800 to-black flex items-center justify-center shadow-sm">
              <Sparkles className="text-white" size={16} />
            </div>
            Lumina Studio
          </h1>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-8 custom-scrollbar">
          
          {/* Product Image */}
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Product Image <span className="text-gray-400 font-normal lowercase">(Optional)</span></label>
            <div className="relative h-32 rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 flex items-center justify-center overflow-hidden hover:bg-gray-100/50 transition-colors cursor-pointer group">
              {productImage ? (
                <>
                  <img src={`data:${productImage.mimeType};base64,${productImage.base64}`} className="w-full h-full object-cover" />
                  <button onClick={(e) => { e.stopPropagation(); setProductImage(null); }} className="absolute top-2 right-2 p-1.5 bg-black/40 hover:bg-black/60 transition-colors rounded-full text-white backdrop-blur-md">
                    <X size={14} />
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center text-gray-400 group-hover:text-gray-500 transition-colors">
                  <Upload size={20} className="mb-2" />
                  <span className="text-sm font-medium">Upload Product</span>
                </div>
              )}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={handleProductUpload} />
            </div>
          </div>

          {/* Style References */}
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Style References <span className="text-gray-400 font-normal lowercase">(Optional)</span></label>
            <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
              {styleImages.map((img, idx) => (
                <div key={idx} className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                  <img src={`data:${img.mimeType};base64,${img.base64}`} className="w-full h-full object-cover" />
                  <button onClick={() => setStyleImages(prev => prev.filter((_, i) => i !== idx))} className="absolute top-1 right-1 p-1 bg-black/40 hover:bg-black/60 transition-colors rounded-full text-white backdrop-blur-md">
                    <X size={10} />
                  </button>
                </div>
              ))}
              <label className="w-20 h-20 shrink-0 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 flex flex-col items-center justify-center text-gray-400 hover:bg-gray-100/50 hover:text-gray-500 transition-colors cursor-pointer shadow-sm">
                <Plus size={20} />
                <input type="file" multiple className="hidden" accept="image/*" onChange={handleStyleUpload} />
              </label>
            </div>
          </div>

          {/* Prompt */}
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Vision</label>
            <textarea 
              className="w-full bg-gray-100/80 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:bg-white transition-all resize-none shadow-inner"
              rows={4}
              placeholder="Describe your vision in detail..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
          </div>

          {/* Settings */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Aspect Ratio</label>
              <SegmentedControl options={['1:1', '4:3', '3:4', '16:9', '9:16']} value={aspectRatio} onChange={setAspectRatio} />
            </div>
            
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Style</label>
              <select 
                className="w-full bg-gray-100/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:bg-white transition-all appearance-none cursor-pointer"
                value={style}
                onChange={e => setStyle(e.target.value)}
              >
                {['None', 'Photorealistic', 'Minimalist', '3D Render', 'Illustration', 'Cinematic'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Generation Count</label>
              <SegmentedControl options={[1, 2, 3]} value={count} onChange={setCount} />
            </div>

            <div className="pt-2 border-t border-gray-100">
              <Switch checked={hasText} onChange={setHasText} label="Include Typography" />
            </div>
          </div>
          
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
              {error}
            </div>
          )}
        </div>
        
        <div className="p-6 bg-white/50 backdrop-blur-xl border-t border-gray-100">
          <button 
            onClick={generateImages}
            disabled={isGenerating || !prompt}
            className="w-full bg-[#1D1D1F] text-white rounded-2xl py-3.5 font-medium flex items-center justify-center gap-2 hover:bg-black disabled:opacity-50 disabled:hover:bg-[#1D1D1F] transition-all active:scale-[0.98] shadow-lg shadow-black/10"
          >
            {isGenerating ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Sparkles size={18} />
            )}
            <span>{isGenerating ? 'Generating...' : 'Generate Images'}</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Top Navigation */}
        <div className="absolute top-6 left-0 right-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white/80 backdrop-blur-xl p-1 rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-gray-200/50 flex gap-1 pointer-events-auto">
            <button 
              onClick={() => setActiveTab('workspace')}
              className={`px-5 py-1.5 rounded-full text-sm font-medium transition-all ${activeTab === 'workspace' ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Workspace
            </button>
            <button 
              onClick={() => setActiveTab('saved')}
              className={`px-5 py-1.5 rounded-full text-sm font-medium transition-all ${activeTab === 'saved' ? 'bg-white shadow-sm text-black' : 'text-gray-500 hover:text-gray-900'}`}
            >
              Saved
            </button>
          </div>
        </div>
        
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-10 pt-28 custom-scrollbar">
          {activeTab === 'workspace' ? (
            <div className="max-w-5xl mx-auto space-y-16 pb-20">
              {generations.length === 0 ? (
                <div className="h-[60vh] flex flex-col items-center justify-center text-gray-400 space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                    <ImageIcon size={32} className="text-gray-300" />
                  </div>
                  <p className="text-sm font-medium">Your generated images will appear here</p>
                </div>
              ) : (
                generations.map(group => (
                  <div key={group.id} className="space-y-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                        <Sparkles size={14} className="text-gray-600" />
                      </div>
                      <h3 className="text-sm font-medium text-gray-800 line-clamp-1">{group.prompt}</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {group.images.map(image => (
                        <div key={image.id} className={`relative group rounded-3xl overflow-hidden bg-gray-100 shadow-sm border border-gray-200/50 ${getAspectRatioClass(group.aspectRatio)}`}>
                          <img src={image.url} className="w-full h-full object-cover" />
                          
                          {/* Hover Overlay */}
                          <div className={`absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-5 ${iteratingImage === image.id ? 'opacity-100 pointer-events-none' : ''}`}>
                            <div className="flex justify-end gap-2">
                              <button onClick={() => saveImage(image)} className="p-2.5 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full text-white transition-colors">
                                {savedImages.find(s => s.id === image.id) ? <Check size={18} /> : <Bookmark size={18} />}
                              </button>
                              <button onClick={() => downloadImage(image)} className="p-2.5 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full text-white transition-colors">
                                <Download size={18} />
                              </button>
                            </div>
                            <div className="flex justify-center">
                              <button onClick={() => { setIteratingImage(image.id); setIterateFeedback(''); setIterateCount(1); }} className="px-5 py-2.5 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full text-white text-sm font-medium flex items-center gap-2 transition-colors shadow-lg">
                                <Sparkles size={16} />
                                Iterate
                              </button>
                            </div>
                          </div>

                          {/* Iterate Popover */}
                          <AnimatePresence>
                            {iteratingImage === image.id && (
                              <motion.div 
                                initial={{ y: '100%' }} 
                                animate={{ y: 0 }} 
                                exit={{ y: '100%' }}
                                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                className="absolute inset-x-0 bottom-0 bg-white/95 backdrop-blur-2xl p-5 border-t border-gray-200/50 flex flex-col gap-4 shadow-[0_-10px_40px_rgba(0,0,0,0.1)]"
                              >
                                <div className="flex justify-between items-center">
                                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Refine Image</span>
                                  <button onClick={() => setIteratingImage(null)} className="text-gray-400 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-full p-1 transition-colors">
                                    <X size={14} />
                                  </button>
                                </div>
                                <input 
                                  type="text"
                                  autoFocus
                                  placeholder="What should we change?"
                                  className="w-full bg-gray-100/80 border-transparent focus:bg-white focus:ring-2 focus:ring-gray-900/10 rounded-xl px-4 py-3 text-sm transition-all shadow-inner"
                                  value={iterateFeedback}
                                  onChange={e => setIterateFeedback(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && iterateFeedback && !isIterating) {
                                      handleIterate(image, group);
                                    }
                                  }}
                                />
                                <div className="flex items-center justify-between">
                                  <div className="w-32">
                                    <SegmentedControl options={[1, 2, 3]} value={iterateCount} onChange={setIterateCount} />
                                  </div>
                                  <button 
                                    onClick={() => handleIterate(image, group)}
                                    disabled={isIterating || !iterateFeedback}
                                    className="bg-[#1D1D1F] text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-black transition-colors disabled:opacity-50 flex items-center gap-2"
                                  >
                                    {isIterating ? (
                                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : 'Generate'}
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="max-w-5xl mx-auto pb-20">
              {savedImages.length === 0 ? (
                <div className="h-[60vh] flex flex-col items-center justify-center text-gray-400 space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                    <Bookmark size={32} className="text-gray-300" />
                  </div>
                  <p className="text-sm font-medium">No saved images yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {savedImages.map(image => (
                    <div key={image.id} className="relative group rounded-2xl overflow-hidden bg-gray-100 shadow-sm border border-gray-200/50 aspect-square">
                      <img src={image.url} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-3">
                        <button onClick={() => downloadImage(image)} className="p-3 bg-white/90 hover:bg-white backdrop-blur-md rounded-full text-gray-900 transition-colors shadow-lg hover:scale-105 active:scale-95">
                          <Download size={18} />
                        </button>
                        <button onClick={() => setSavedImages(prev => prev.filter(s => s.id !== image.id))} className="p-3 bg-white/90 hover:bg-white backdrop-blur-md rounded-full text-red-500 transition-colors shadow-lg hover:scale-105 active:scale-95">
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
