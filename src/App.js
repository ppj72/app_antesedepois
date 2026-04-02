import React, { useState, useRef, useEffect } from 'react';
import { 
  Sliders, Wand2, Download, Image as ImageIcon, 
  Mic, AlertCircle, Eraser, Upload, ChevronsLeftRight, Grid, SplitSquareHorizontal, Layers, Trash2, Maximize, RotateCw, RefreshCcw, Hand, Check, Eye, X, Fingerprint, Sparkle
} from 'lucide-react';

// --- CONFIGURAÇÕES DE API ---
const apiKey = "AIzaSyBpFg3Ti39MjO89B4hvFzB2myfYurWGuGw"; 
const TEXT_MODEL_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
const IMAGE_EDIT_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

// --- UTILITÁRIOS ---
const fetchAPI = async (url, payload) => {
  const delays = [1000, 2000, 4000];
  let lastError = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const text = await response.text();
      if (!response.ok) {
        let errorMsg = `Erro HTTP ${response.status}`;
        
        if (response.status === 401) {
            errorMsg = "SESSÃO EXPIRADA (Erro 401). O servidor desconectou o acesso. Pressione F5 para atualizar a página e reconectar.";
        } else if (response.status === 400) {
            errorMsg = "FILTRO DE SEGURANÇA (Erro 400). A IA considerou a modificação muito extrema ou bloqueou o pedido por segurança.";
        } else if (response.status === 429) {
            errorMsg = "SOBRECARGA (Erro 429). Demasiados pedidos em simultâneo. A aguardar...";
        } else {
            try {
              const errData = JSON.parse(text);
              if (errData.error?.message) errorMsg += `: ${errData.error.message}`;
            } catch (e) {
               if (text) errorMsg += ` - ${text.substring(0, 150)}`;
            }
        }
        throw new Error(errorMsg);
      }
      if (!text) return {};
      try { return JSON.parse(text); } 
      catch (err) { throw new Error("JSON inválido da API."); }
    } catch (error) {
      lastError = error;
      if (lastError.message.includes('401') || lastError.message.includes('400') || attempt === delays.length) break;
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
  throw lastError;
};

const pcm16Base64ToWav = (base64, sampleRate = 24000) => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  const buffer = new ArrayBuffer(44 + len);
  const view = new DataView(buffer);
  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + len, true);
  writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); 
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); writeString(view, 36, 'data');
  view.setUint32(40, len, true);
  new Uint8Array(buffer, 44).set(bytes);
  return new Blob([view], { type: 'audio/wav' });
};

// COMPRESSOR DINÂMICO DE SEGURANÇA
const compressImageStr = async (base64Str, maxSize = 512, quality = 0.5) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxSize) {
        height = Math.round(height * (maxSize / width));
        width = maxSize;
      } else if (height > maxSize) {
        width = Math.round(width * (maxSize / height));
        height = maxSize;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.src = `data:image/jpeg;base64,${base64Str}`;
  });
};

export default function App() {
  // --- ESTADOS PRINCIPAIS ---
  const [originalImage, setOriginalImage] = useState(null);
  const [sessions, setSessions] = useState([]); 
  const [gallery, setGallery] = useState([]);   
  
  // LIVE PREVIEW STATES
  const [previewImage, setPreviewImage] = useState(null);
  const previewRequestId = useRef(0);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  
  // Modos e Layout
  const [viewMode, setViewMode] = useState('slider'); 
  const [gridCount, setGridCount] = useState(2);      
  const [showLine, setShowLine] = useState(true);     
  
  // Transformações por Quadro
  const defaultTransform = { x: 0, y: 0, scale: 1, rot: 0 };
  const [transforms, setTransforms] = useState([defaultTransform, defaultTransform, defaultTransform, defaultTransform]);
  const [activePanel, setActivePanel] = useState(null); 
  const [dragStart, setDragStart] = useState(null);

  const [comparePos, setComparePos] = useState(50); 
  const [isDraggingCompare, setIsDraggingCompare] = useState(false);

  // SIDEBAR TABS (Estética vs Realismo)
  const [sidebarTab, setSidebarTab] = useState('estetica');
  const [activeRealismLayer, setActiveRealismLayer] = useState(null);
  const [activeAestheticLayer, setActiveAestheticLayer] = useState(null);

  // --- AJUSTES DE ESTÉTICA (MOTOR ANATÔMICO) ---
  const defaultAdjustments = {
    lighting: 0,
    noseRefinement: 0, noseNarrow: 0, noseTipLift: 0, noseBridgeAlign: 0,
    jawlineDef: 0, jawlineNarrow: 0, jawlineAngular: 0,
    chinProject: 0, chinNarrow: 0, chinRound: 0,
    cheekboneVol: 0, cheekboneLift: 0, cheekboneNarrow: 0,
    neckDoubleChin: 0, neckDef: 0, neckLift: 0,
    faceFlaccidity: 0, faceLift: 0,
    browLift: 0, foreheadSmooth: 0,
    eyeOpen: 0, eyeOuterLift: 0,
    lipVol: 0, lipContour: 0, lipGloss: 0,
    preserveIdentity: 0, naturalProportions: 0, globalHarmony: 0
  };
  const [adjustments, setAdjustments] = useState(defaultAdjustments);

  const aestheticLayers = [
    { id: 'a1', title: '1. Nariz', theme: { text: 'text-yellow-500', accent: 'accent-yellow-500', border: 'border-yellow-500/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'noseRefinement', label: 'Rinomodelação' }, { id: 'noseNarrow', label: 'Afinar Nariz' }, { id: 'noseTipLift', label: 'Elevar Ponta' }, { id: 'noseBridgeAlign', label: 'Alinhar Dorso' }
    ]},
    { id: 'a2', title: '2. Maxilar & Mandíbula', theme: { text: 'text-pink-500', accent: 'accent-pink-500', border: 'border-pink-500/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'jawlineDef', label: 'Definir Maxilar' }, { id: 'jawlineNarrow', label: 'Afinar Mandíbula' }, { id: 'jawlineAngular', label: 'Mandíbula Angular' }
    ]},
    { id: 'a3', title: '3. Queixo', theme: { text: 'text-yellow-400', accent: 'accent-yellow-400', border: 'border-yellow-400/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'chinProject', label: 'Projetar Queixo' }, { id: 'chinNarrow', label: 'Afinar Queixo' }, { id: 'chinRound', label: 'Arredondar Queixo' }
    ]},
    { id: 'a4', title: '4. Maçãs do Rosto', theme: { text: 'text-pink-400', accent: 'accent-pink-400', border: 'border-pink-400/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'cheekboneVol', label: 'Aumentar Volume' }, { id: 'cheekboneLift', label: 'Lifting Maçã' }, { id: 'cheekboneNarrow', label: 'Afinar Bochechas' }
    ]},
    { id: 'a5', title: '5. Pescoço & Papada', theme: { text: 'text-yellow-500', accent: 'accent-yellow-500', border: 'border-yellow-500/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'neckDoubleChin', label: 'Reduzir Papada' }, { id: 'neckDef', label: 'Definir Pescoço' }, { id: 'neckLift', label: 'Lifting Cervical' }
    ]},
    { id: 'a6', title: '6. Flacidez Facial', theme: { text: 'text-pink-500', accent: 'accent-pink-500', border: 'border-pink-500/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'faceFlaccidity', label: 'Reduzir Flacidez' }, { id: 'faceLift', label: 'Lifting Facial Leve' }
    ]},
    { id: 'a7', title: '7. Testa & Sobrancelhas', theme: { text: 'text-yellow-400', accent: 'accent-yellow-400', border: 'border-yellow-400/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'browLift', label: 'Elevar Sobrancelhas' }, { id: 'foreheadSmooth', label: 'Suavizar Testa' }
    ]},
    { id: 'a8', title: '8. Olhos', theme: { text: 'text-pink-400', accent: 'accent-pink-400', border: 'border-pink-400/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'eyeOpen', label: 'Abrir Olhar' }, { id: 'eyeOuterLift', label: 'Lifting Canto Externo' }
    ]},
    { id: 'a9', title: '9. Lábios', theme: { text: 'text-yellow-500', accent: 'accent-yellow-500', border: 'border-yellow-500/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'lipVol', label: 'Aumentar Volume' }, { id: 'lipContour', label: 'Definir Contorno' }, { id: 'lipGloss', label: 'Gloss / Volume Exp.' }
    ]},
    { id: 'a10', title: '10. Realismo & Harmonia', theme: { text: 'text-pink-500', accent: 'accent-pink-500', border: 'border-pink-500/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'preserveIdentity', label: 'Preservar Identidade' }, { id: 'naturalProportions', label: 'Proporção Natural' }, { id: 'globalHarmony', label: 'Harmonização Global' }
    ]}
  ];
  
  const [bgSettings, setBgSettings] = useState({ type: 'original', color: '#eab308' });

  const defaultHairSettings = { color: 'original', style: 'original', length: 'original', cut: 'original', headband: false, headbandColor: '#ffffff' };
  const [hairSettings, setHairSettings] = useState(defaultHairSettings);

  const [logoState, setLogoState] = useState({ image: null, color: '#000000', size: 60, x: 50, y: 15 });
  const [coloredLogoUrl, setColoredLogoUrl] = useState(null);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const logoInputRef = useRef(null);

  // --- AJUSTES DO MOTOR DE REALISMO ---
  const defaultRealism = {
    pores: 0, peachFuzz: 0, unevenTexture: 0, fineLines: 0, microWrinkles: 0,
    tonalVariation: 0, naturalRedness: 0, freckles: 0, subtleSpots: 0,
    oiliness: 0, hydration: 0, microHighlights: 0,
    asymmetry: 0, minorImperfections: 0, lipTexture: 0,
    eyeMoisture: 0, eyeVeins: 0, eyeCatchlights: 0,
    strayHairs: 0, hairTexture: 0,
    naturalLighting: 0, naturalShadows: 0,
    sensorNoise: 0, opticalSharpness: 0, cameraCompression: 0,
    subsurfaceScattering: 0
  };
  const [realismSettings, setRealismSettings] = useState(defaultRealism);

  const realismLayers = [
    { id: 'c1', title: 'C1. Microtextura', theme: { text: 'text-yellow-500', accent: 'accent-yellow-500', border: 'border-yellow-500/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'pores', label: 'Poros Nítidos' }, { id: 'peachFuzz', label: 'Micro-Pelos' }, { id: 'unevenTexture', label: 'Text. Irregular' }, { id: 'fineLines', label: 'Linhas Finas' }, { id: 'microWrinkles', label: 'Rugas Dinâmicas' }
    ]},
    { id: 'c2', title: 'C2. Variação Tonal', theme: { text: 'text-pink-500', accent: 'accent-pink-500', border: 'border-pink-500/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'tonalVariation', label: 'Micro Variação' }, { id: 'naturalRedness', label: 'Vermelhidão' }, { id: 'freckles', label: 'Sardas' }, { id: 'subtleSpots', label: 'Manchas Sutis' }
    ]},
    { id: 'c3', title: 'C3. Superfície', theme: { text: 'text-yellow-400', accent: 'accent-yellow-400', border: 'border-yellow-400/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'oiliness', label: 'Oleosidade' }, { id: 'hydration', label: 'Pele Hidratada' }, { id: 'microHighlights', label: 'Micro Brilho' }
    ]},
    { id: 'c4', title: 'C4. Imperfeições', theme: { text: 'text-pink-400', accent: 'accent-pink-400', border: 'border-pink-400/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'asymmetry', label: 'Assimetria' }, { id: 'minorImperfections', label: 'Imperfeições Leves' }, { id: 'lipTexture', label: 'Textura Labial' }
    ]},
    { id: 'c5', title: 'C5. Olhos', theme: { text: 'text-yellow-500', accent: 'accent-yellow-500', border: 'border-yellow-500/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'eyeMoisture', label: 'Umidade Ocular' }, { id: 'eyeVeins', label: 'Micro Veias' }, { id: 'eyeCatchlights', label: 'Brilho Realista' }
    ]},
    { id: 'c6', title: 'C6. Cabelo', theme: { text: 'text-pink-500', accent: 'accent-pink-500', border: 'border-pink-500/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'strayHairs', label: 'Fios Soltos' }, { id: 'hairTexture', label: 'Textura Capilar' }
    ]},
    { id: 'c7', title: 'C7. Física da Luz', theme: { text: 'text-yellow-400', accent: 'accent-yellow-400', border: 'border-yellow-400/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'naturalLighting', label: 'Luz Natural' }, { id: 'naturalShadows', label: 'Sombras Faciais' }
    ]},
    { id: 'c8', title: 'C8. Lente / Câmera', theme: { text: 'text-pink-400', accent: 'accent-pink-400', border: 'border-pink-400/30', bg: 'bg-pink-900/20' }, items: [
      { id: 'sensorNoise', label: 'Ruído de Sensor' }, { id: 'opticalSharpness', label: 'Nitidez Óptica' }, { id: 'cameraCompression', label: 'Compressão JPEG' }
    ]},
    { id: 'cx', title: 'C-EXTRA. Biologia', theme: { text: 'text-yellow-500', accent: 'accent-yellow-500', border: 'border-yellow-500/30', bg: 'bg-yellow-900/20' }, items: [
      { id: 'subsurfaceScattering', label: 'Dispersão SSS' }
    ]}
  ];

  const [fullscreenImage, setFullscreenImage] = useState(null);

  // Janete IA
  const [janeteChat, setJaneteChat] = useState([]);
  const [janeteInput, setJaneteInput] = useState('');
  const [isJaneteThinking, setIsJaneteThinking] = useState(false);
  const [isJaneteSpeaking, setIsJaneteSpeaking] = useState(false);
  const [isGeneratingPatient, setIsGeneratingPatient] = useState(false);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!logoState.image) {
        setColoredLogoUrl(null);
        return;
    }
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = logoState.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        setColoredLogoUrl(canvas.toDataURL('image/png'));
    };
    img.src = `data:image/png;base64,${logoState.image}`;
  }, [logoState.image, logoState.color]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 512; 
        let width = img.width;
        let height = img.height;

        if (width > height && width > MAX_SIZE) {
          height = Math.round(height * (MAX_SIZE / width));
          width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
          width = Math.round(width * (MAX_SIZE / height));
          height = MAX_SIZE;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const base64String = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
        
        setOriginalImage(base64String);
        setSessions([]); 
        setPreviewImage(null);
        setAdjustments(defaultAdjustments);
        setRealismSettings(defaultRealism);
        setBgSettings({ type: 'original', color: '#eab308' });
        setHairSettings(defaultHairSettings);
        setTransforms([defaultTransform, defaultTransform, defaultTransform, defaultTransform]);
        setComparePos(50);
        setErrorMsg('');
        setHasPendingChanges(false);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoState(prev => ({ ...prev, image: reader.result.split(',')[1] }));
    };
    reader.readAsDataURL(file);
  };

  const latestBaseImage = sessions.length > 0 ? sessions[sessions.length - 1] : originalImage;

  // --- RENDERIZADOR (GATILHO MANUAL) ---
  const generatePreview = async (currentAdjustments, currentRealism, currentBg, currentHair) => {
    if (!originalImage) return;
    
    const reqId = Date.now();
    previewRequestId.current = reqId;

    let adj = [];
    
    const { 
      lighting, noseRefinement, noseNarrow, noseTipLift, noseBridgeAlign,
      jawlineDef, jawlineNarrow, jawlineAngular, chinProject, chinNarrow, chinRound,
      cheekboneVol, cheekboneLift, cheekboneNarrow, neckDoubleChin, neckDef, neckLift,
      faceFlaccidity, faceLift, browLift, foreheadSmooth, eyeOpen, eyeOuterLift,
      lipVol, lipContour, lipGloss, preserveIdentity, naturalProportions, globalHarmony
    } = currentAdjustments;

    if (noseRefinement > 0) adj.push(`Refine the nose shape by creating a smooth, sloped concave nasal bridge (negative curve) and a noticeably lifted, pointy, upturned nasal tip, improving symmetry while preserving identity (+${noseRefinement}%)`);
    if (noseNarrow > 0) adj.push(`Slightly narrow the nasal bridge and nostrils while maintaining natural proportions and realistic facial harmony (+${noseNarrow}%)`);
    if (noseTipLift > 0) adj.push(`Subtly lift the nasal tip creating a more refined nasal profile while keeping natural structure and skin continuity (+${noseTipLift}%)`);
    if (noseBridgeAlign > 0) adj.push(`Smooth and align the nasal bridge reducing minor irregularities while maintaining a natural appearance (+${noseBridgeAlign}%)`);
    
    if (jawlineDef > 0) adj.push(`Enhance jawline definition by subtly increasing contrast and structural clarity along the mandibular line while preserving natural facial proportions (+${jawlineDef}%)`);
    if (jawlineNarrow > 0) adj.push(`Slightly reduce the width of the lower jaw creating a more refined facial contour while maintaining realistic structure (+${jawlineNarrow}%)`);
    if (jawlineAngular > 0) adj.push(`Introduce a slightly more angular jawline with subtle shadowing and structural enhancement to create a defined lower face (+${jawlineAngular}%)`);
    
    if (chinProject > 0) adj.push(`Slightly project the chin forward to create balanced facial proportions and a stronger lower face profile (+${chinProject}%)`);
    if (chinNarrow > 0) adj.push(`Subtly narrow the chin width while maintaining smooth transition with the jawline (+${chinNarrow}%)`);
    if (chinRound > 0) adj.push(`Create a softer rounded chin contour with natural blending into the jawline (+${chinRound}%)`);
    
    if (cheekboneVol > 0) adj.push(`Enhance cheekbone prominence by subtly increasing cheek volume and structure while preserving natural facial harmony (+${cheekboneVol}%)`);
    if (cheekboneLift > 0) adj.push(`Gently lift the cheek area creating a youthful contour while maintaining realistic skin tension (+${cheekboneLift}%)`);
    if (cheekboneNarrow > 0) adj.push(`Slightly reduce cheek fullness to create a more sculpted facial contour while keeping natural softness (+${cheekboneNarrow}%)`);
    
    if (neckDoubleChin > 0) adj.push(`Subtly reduce submental fullness beneath the chin creating a smoother neck contour while maintaining natural skin texture (+${neckDoubleChin}%)`);
    if (neckDef > 0) adj.push(`Enhance the neck contour and jawline transition by reducing soft tissue under the chin and refining the profile (+${neckDef}%)`);
    if (neckLift > 0) adj.push(`Apply subtle tightening of the neck skin improving firmness while preserving natural folds and skin realism (+${neckLift}%)`);
    
    if (faceFlaccidity > 0) adj.push(`Gently tighten facial skin reducing sagging in the cheeks and jawline while preserving natural skin texture and age characteristics (+${faceFlaccidity}%)`);
    if (faceLift > 0) adj.push(`Apply a subtle lifting effect across mid-face and jawline creating a fresher and more youthful appearance without altering identity (+${faceLift}%)`);
    
    if (browLift > 0) adj.push(`Slightly lift the eyebrow position creating a more open and refreshed eye area while preserving natural expression (+${browLift}%)`);
    if (foreheadSmooth > 0) adj.push(`Reduce deep forehead creases subtly while maintaining natural skin texture and facial movement (+${foreheadSmooth}%)`);
    
    if (eyeOpen > 0) adj.push(`Subtly increase eye openness and brightness while maintaining natural eyelid structure (+${eyeOpen}%)`);
    if (eyeOuterLift > 0) adj.push(`Gently elevate the outer corners of the eyes creating a subtle almond eye effect while preserving natural proportions (+${eyeOuterLift}%)`);
    
    if (lipVol > 0) adj.push(`Enhance lip volume slightly while preserving natural lip structure and maintaining realistic texture (+${lipVol}%)`);
    if (lipContour > 0) adj.push(`Improve lip contour definition while maintaining soft natural transitions (+${lipContour}%)`);
    if (lipGloss > 0) adj.push(`Visually apply highly realistic expressive lip volume with a natural transparent glossy hydration effect, cinematic lip plumping, strictly NO colorful lipstick (+${lipGloss}%)`);
    
    if (preserveIdentity > 0) adj.push(`Maintain the original facial identity and unique facial landmarks while applying any aesthetic adjustments (+${preserveIdentity}%)`);
    if (naturalProportions > 0) adj.push(`Ensure all facial modifications follow realistic human proportions and symmetry (+${naturalProportions}%)`);
    if (globalHarmony > 0) adj.push(`Apply subtle global facial harmony adjustments balancing nose, chin, jawline and cheekbones while preserving the person's identity and natural proportions (+${globalHarmony}%)`);
    
    if (lighting !== 0) adj.push(lighting > 0 ? `bright studio beauty lighting, soft frontal key light (+${lighting}%)` : `cinematic moody lighting, deep dramatic shadows (${Math.abs(lighting)}%)`);

    const { 
      pores, peachFuzz, unevenTexture, fineLines, microWrinkles, 
      tonalVariation, naturalRedness, freckles, subtleSpots, 
      oiliness, hydration, microHighlights, 
      asymmetry, minorImperfections, lipTexture, 
      eyeMoisture, eyeVeins, eyeCatchlights, 
      strayHairs, hairTexture, 
      naturalLighting, naturalShadows, 
      sensorNoise, opticalSharpness, cameraCompression, 
      subsurfaceScattering 
    } = currentRealism;

    if (pores > 0) adj.push(`Add realistic human skin pores across the face, especially visible on the nose, cheeks and forehead. Pores vary in size and density naturally, following real dermatological patterns. Avoid uniform repetition and preserve natural randomness of human skin texture (+${pores}%)`);
    if (peachFuzz > 0) adj.push(`Add subtle vellus facial hair (peach fuzz) across cheeks, jawline and forehead. The micro hairs are extremely fine, semi-transparent and softly illuminated by natural light, barely visible but contributing to authentic human skin realism (+${peachFuzz}%)`);
    if (unevenTexture > 0) adj.push(`Introduce subtle uneven micro-texture to the skin surface including tiny bumps, micro-lines and natural irregularities that occur in real human skin. Avoid smooth or plastic appearance while preserving healthy skin tone (+${unevenTexture}%)`);
    if (fineLines > 0) adj.push(`Add delicate natural expression lines around the eyes, mouth and forehead. Lines should be subtle and consistent with relaxed facial expressions, not deep wrinkles (+${fineLines}%)`);
    if (microWrinkles > 0) adj.push(`Add realistic micro-wrinkles that appear naturally when skin folds around the eyes and smile area, maintaining subtlety (+${microWrinkles}%)`);
    if (tonalVariation > 0) adj.push(`Introduce subtle variations of skin tone across the face including warmer tones on cheeks, cooler tones near temples and natural tonal transitions typical of real human skin (+${tonalVariation}%)`);
    if (naturalRedness > 0) adj.push(`Add slight natural warmth and blush on cheeks, nose edges and chin. The effect should be soft and blended (+${naturalRedness}%)`);
    if (freckles > 0) adj.push(`Add light natural freckles across cheeks and nose bridge. Freckles vary in size, color and distribution with realistic randomness (+${freckles}%)`);
    if (subtleSpots > 0) adj.push(`Add very subtle natural skin spots and pigment variations typical of real human skin, maintaining a healthy and natural appearance (+${subtleSpots}%)`);
    if (oiliness > 0) adj.push(`Add subtle natural skin oil reflections on nose, forehead and cheekbones. Highlights should appear soft and realistic as produced by natural skin oils under light (+${oiliness}%)`);
    if (hydration > 0) adj.push(`Create a soft hydrated skin effect with gentle specular highlights, giving a slightly dewy appearance without looking glossy or artificial (+${hydration}%)`);
    if (microHighlights > 0) adj.push(`Add subtle specular highlights across the skin surface following natural lighting direction, simulating how real skin reflects light (+${microHighlights}%)`);
    if (asymmetry > 0) adj.push(`Introduce subtle natural asymmetry in facial features such as slightly uneven eyebrow height, small differences in cheek structure or lip curvature to mimic real human anatomy (+${asymmetry}%)`);
    if (minorImperfections > 0) adj.push(`Add extremely subtle natural imperfections such as tiny blemishes, minor pores clustering or slight skin irregularities to avoid artificial perfection (+${minorImperfections}%)`);
    if (lipTexture > 0) adj.push(`Enhance lips with realistic fine lip lines, subtle moisture reflections and natural softness while maintaining authentic human texture (+${lipTexture}%)`);
    if (eyeMoisture > 0) adj.push(`Add subtle moisture reflections on the eyes and along the lower eyelid waterline, enhancing the natural wetness of real eyes (+${eyeMoisture}%)`);
    if (eyeVeins > 0) adj.push(`Introduce extremely subtle sclera details in the whites of the eyes to increase biological realism (+${eyeVeins}%)`);
    if (eyeCatchlights > 0) adj.push(`Add realistic catchlights in the eyes reflecting the light source, maintaining correct perspective and natural intensity (+${eyeCatchlights}%)`);
    if (strayHairs > 0) adj.push(`Add subtle flyaway hair strands around the hairline and temples to simulate natural hair movement and imperfection (+${strayHairs}%)`);
    if (hairTexture > 0) adj.push(`Enhance individual hair strand detail and natural variation in thickness and direction (+${hairTexture}%)`);
    if (naturalLighting > 0) adj.push(`Apply physically realistic soft natural lighting with gentle shadows and gradual falloff across the face, avoiding studio-like beauty lighting (+${naturalLighting}%)`);
    if (naturalShadows > 0) adj.push(`Add subtle natural shadow gradients around the nose, under the chin and around eye sockets consistent with real light direction (+${naturalShadows}%)`);
    if (sensorNoise > 0) adj.push(`Add very subtle digital sensor noise typical of real camera capture, especially in shadow areas (+${sensorNoise}%)`);
    if (opticalSharpness > 0) adj.push(`Apply realistic lens sharpness preserving skin texture while avoiding artificial over-sharpening (+${opticalSharpness}%)`);
    if (cameraCompression > 0) adj.push(`Add extremely subtle compression artifacts consistent with smartphone photography (+${cameraCompression}%)`);
    if (subsurfaceScattering > 0) adj.push(`Simulate realistic subsurface skin scattering where light softly penetrates the skin and diffuses through underlying tissue, producing natural warmth and depth typical of real human skin (+${subsurfaceScattering}%)`);

    const colorMap = { 'original': '', 'loiro': 'blonde', 'castanho': 'brown', 'preto': 'black', 'ruivo': 'red', 'platinado': 'platinum blonde' };
    const styleMap = { 'original': '', 'liso': 'straight', 'ondulado': 'wavy', 'cacheado': 'curly', 'crespo': 'coily' };
    const lengthMap = { 'original': '', 'curto': 'short', 'médio': 'medium', 'longo': 'long' };
    const cutMap = { 'original': '', 'bob': 'bob cut', 'camadas': 'layered cut', 'franja': 'with bangs', 'pixie': 'pixie cut' };

    let hairPrompt = [];
    if (currentHair.color !== 'original') hairPrompt.push(`${colorMap[currentHair.color]} hair color`);
    if (currentHair.style !== 'original') hairPrompt.push(`${styleMap[currentHair.style]} hair texture`);
    if (currentHair.length !== 'original') hairPrompt.push(`${lengthMap[currentHair.length]} length hair`);
    if (currentHair.cut !== 'original') hairPrompt.push(`${cutMap[currentHair.cut]}`);
    
    if (currentHair.headband) {
       hairPrompt.push(`wearing a solid ${currentHair.headbandColor} colored professional spa headband on the forehead, keeping all hair pulled back`);
    }

    if (hairPrompt.length > 0) {
        adj.push(`Hair style modifications: ${hairPrompt.join(', ')}`);
    }

    let bgPrompt = "";
    if (currentBg.type === 'bokeh') bgPrompt = "Apply a strong optical bokeh background blur effect, shallow depth of field.";
    if (currentBg.type === 'neutral') bgPrompt = "Replace background perfectly with a solid, clean neutral grey studio backdrop.";
    if (currentBg.type === 'color') bgPrompt = `Replace background perfectly with a solid color backdrop (Hex: ${currentBg.color}).`;

    if (adj.length === 0 && !bgPrompt) {
      if (previewRequestId.current === reqId) {
        setPreviewImage(null);
        setIsProcessing(false);
        setHasPendingChanges(false);
      }
      return;
    }

    setIsProcessing(true);
    setErrorMsg('');

    try {
      // QUOTA SAVER: Força a compressão máxima permitida (512px @ 60%) sempre antes de enviar para a API
      let safeImageBase64 = latestBaseImage;
      safeImageBase64 = await compressImageStr(safeImageBase64, 512, 0.6);

      const prompt = `Perform a high-end digital portrait retouching. Maintain the exact original identity, skin tone, and pose. Adjust facial proportions and texture exactly as requested. ${bgPrompt} Apply ONLY the following photographic modifications: ${adj.join(', ')}. The final image MUST look like a raw, high-fidelity professional photograph. Strictly NO UNNATURAL FILTERS, NO PLASTIC SKIN. MAINTAIN EXACT ORIGINAL ASPECT RATIO AND DIMENSIONS.`;

      const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: safeImageBase64 } }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
      };

      const data = await fetchAPI(IMAGE_EDIT_URL, payload);
      const newImageBase64 = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      
      if (newImageBase64 && previewRequestId.current === reqId) {
        setPreviewImage(newImageBase64);
        setHasPendingChanges(false);
      } else if (!newImageBase64) {
        throw new Error("Falha na renderização da imagem. O servidor não devolveu um resultado visual válido.");
      }
    } catch (error) {
      if (previewRequestId.current === reqId) setErrorMsg(error.message);
    } finally { 
      if (previewRequestId.current === reqId) setIsProcessing(false); 
    }
  };

  // Observador de Alterações (Apenas ativa o aviso do botão em vez de disparar a IA)
  useEffect(() => {
    if (!originalImage) return;

    const hasEdits = Object.values(adjustments).some(val => val !== 0) || 
                     bgSettings.type !== 'original' || 
                     Object.values(hairSettings).some(val => val !== 'original' && val !== false) ||
                     Object.values(realismSettings).some(val => val !== 0);
    
    if (!hasEdits) {
      setPreviewImage(null);
      setHasPendingChanges(false);
      return;
    }

    setHasPendingChanges(true);
  }, [adjustments, realismSettings, bgSettings, hairSettings, originalImage]);

  const commitToGrid = () => {
    if (previewImage && sessions.length < gridCount - 1) {
      setSessions([...sessions, previewImage]);
      setComparePos(50);
    }
  };

  // --- JANETE IA (JARVIS) ---
  const handleJaneteSubmit = async (e, textOverride = null) => {
    if (e) e.preventDefault();
    const textToProcess = textOverride || janeteInput;
    if (!textToProcess.trim()) return;

    const newChat = [...janeteChat, { role: 'user', text: textToProcess }];
    setJaneteChat(newChat);
    setJaneteInput('');
    setIsJaneteThinking(true);

    try {
      const systemPrompt = `Você é Janete, a IA assistente futurista estilo Jarvis da Karoline Beauty. O usuário é o Sr. Percílio.
      STATUS ATUAL DO SISTEMA: ${originalImage ? "Uma paciente já está carregada no visualizador." : "NENHUMA FOTO CARREGADA. Se o usuário pedir edições estéticas, avise-o educadamente que ele precisa enviar uma foto primeiro ou pedir para você gerar uma paciente virtual do zero."}
      Você possui acesso à personalização capilar, estética e também ao módulo do Motor de Realismo da paciente.
      DIRETRIZ DE HIPER-REALISMO (Pipeline Sugerido): Para criar hiper-realismo perceptivo, quando solicitado, você deve combinar a ativação simultânea das seguintes chaves em 'realismSettings': pores (Poros nítidos) + peachFuzz (Micro-pelos) + tonalVariation (Micro variação tonal) + oiliness (Oleosidade natural) + eyeCatchlights (Brilho ocular) + naturalLighting (Iluminação natural) + sensorNoise (Ruído de sensor). A soma dessas camadas cria o hiper-realismo perfeito.
      Cores Capilares aceitas: "loiro", "castanho", "preto", "ruivo", "platinado" ou "original".
      
      GERAÇÃO DE PACIENTE (NOVO): Se o usuário pedir para "gerar", "criar" uma foto ou paciente do zero, preencha a chave "generateNewPatient" com um prompt em INGLÊS EXTREMAMENTE DETALHADO para uma foto de rosto clínico (Exemplo: "Photorealistic raw portrait of a 30-year-old blonde woman, completely no makeup, bare face, neutral expression, crisp cold white and subtle bluish clinical lighting mixed with soft realistic overcast daylight, visible skin pores, fine lines, authentic skin texture, aesthetic medicine before photo, highly detailed, sharp focus"). É OBRIGATÓRIO incluir na descrição a iluminação clínica fria e azulada com luz nublada difusa ("crisp cold white and subtle bluish clinical lighting mixed with soft realistic overcast daylight"). Se não pedir para gerar nova foto, deixe esta chave como o valor booleano false.
      
      Retorne APENAS um JSON VÁLIDO obedecendo a estrutura exata: 
      {"message": "Sua resposta curta", "generateNewPatient": false, "adjustments": {"lighting":0, "noseRefinement":0, "noseNarrow":0, "noseTipLift":0, "noseBridgeAlign":0, "jawlineDef":0, "jawlineNarrow":0, "jawlineAngular":0, "chinProject":0, "chinNarrow":0, "chinRound":0, "cheekboneVol":0, "cheekboneLift":0, "cheekboneNarrow":0, "neckDoubleChin":0, "neckDef":0, "neckLift":0, "faceFlaccidity":0, "faceLift":0, "browLift":0, "foreheadSmooth":0, "eyeOpen":0, "eyeOuterLift":0, "lipVol":0, "lipContour":0, "lipGloss":0, "preserveIdentity":0, "naturalProportions":0, "globalHarmony":0}, "realismSettings": {"pores":0, "peachFuzz":0, "unevenTexture":0, "fineLines":0, "microWrinkles":0, "tonalVariation":0, "naturalRedness":0, "freckles":0, "subtleSpots":0, "oiliness":0, "hydration":0, "microHighlights":0, "asymmetry":0, "minorImperfections":0, "lipTexture":0, "eyeMoisture":0, "eyeVeins":0, "eyeCatchlights":0, "strayHairs":0, "hairTexture":0, "naturalLighting":0, "naturalShadows":0, "sensorNoise":0, "opticalSharpness":0, "cameraCompression":0, "subsurfaceScattering":0}, "hairSettings": {"color":"original", "style":"original", "length":"original", "cut":"original", "headband":false, "headbandColor":"#ffffff"}, "logoSettings": {"color":"#db2777"}}`;
      
      const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: newChat.map(msg => ({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] })),
        generationConfig: { responseMimeType: "application/json" }
      };

      const data = await fetchAPI(TEXT_MODEL_URL, payload);
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (responseText) {
        const jsonResponse = JSON.parse(responseText);
        
        if (jsonResponse.generateNewPatient && jsonResponse.generateNewPatient !== false) {
           setJaneteChat([...newChat, { role: 'model', text: jsonResponse.message + " Iniciando biogênese digital..." }]);
           generateJaneteVoice(jsonResponse.message);
           setIsGeneratingPatient(true);
           
           try {
             const genPayload = {
               contents: [{ role: "user", parts: [{ text: "Generate a high-fidelity photorealistic raw portrait under crisp cold white and subtle bluish clinical lighting mixed with soft realistic overcast daylight: " + jsonResponse.generateNewPatient }] }],
               generationConfig: { responseModalities: ['IMAGE'] }
             };
             const genData = await fetchAPI(IMAGE_EDIT_URL, genPayload);
             const base64 = genData.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
             
             if (base64) {
                const safeImageBase64 = await compressImageStr(base64, 512, 0.8);
                setOriginalImage(safeImageBase64);
                setSessions([]);
                setPreviewImage(null);
                setAdjustments(defaultAdjustments);
                setRealismSettings(defaultRealism);
                setBgSettings({ type: 'original', color: '#eab308' });
                setHairSettings(defaultHairSettings);
                setTransforms([defaultTransform, defaultTransform, defaultTransform, defaultTransform]);
                setComparePos(50);
                setErrorMsg('');
                setHasPendingChanges(false);
                setJaneteChat(prev => [...prev, { role: 'model', text: "Paciente virtual importada com sucesso." }]);
             } else {
                throw new Error("Falha ao renderizar a paciente.");
             }
           } catch(e) {
             setJaneteChat(prev => [...prev, { role: 'model', text: "Houve um distúrbio no gerador de imagens: " + e.message }]);
           } finally {
             setIsGeneratingPatient(false);
           }
        } else {
           // Fluxo normal de ajustes via JANETE - Aplica automaticamente a edição para a IA
           const newAdj = jsonResponse.adjustments ? { ...defaultAdjustments, ...jsonResponse.adjustments } : adjustments;
           const newReal = jsonResponse.realismSettings ? { ...defaultRealism, ...jsonResponse.realismSettings } : realismSettings;
           const newHair = jsonResponse.hairSettings ? { ...defaultHairSettings, ...jsonResponse.hairSettings } : hairSettings;
           
           setJaneteChat([...newChat, { role: 'model', text: jsonResponse.message }]);
           if (jsonResponse.adjustments) setAdjustments(newAdj);
           if (jsonResponse.realismSettings) setRealismSettings(newReal);
           if (jsonResponse.hairSettings) setHairSettings(newHair);
           generateJaneteVoice(jsonResponse.message);
           
           // Aplica automaticamente para o utilizador
           if (originalImage) {
               generatePreview(newAdj, newReal, bgSettings, newHair);
           }
        }
      }
    } catch (error) {
      setJaneteChat([...newChat, { role: 'model', text: "Falha de conexão no sistema principal, Sr. Percílio." }]);
    } finally { setIsJaneteThinking(false); }
  };

  const generateJaneteVoice = async (text) => {
    try {
      const ttsPayload = {
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
        model: "gemini-2.5-flash-preview-tts"
      };
      const data = await fetchAPI(TTS_URL, ttsPayload);
      const pcmBase64 = data.candidates?.[0]?.content?.parts?.[0].inlineData?.data;
      if (pcmBase64) {
        const wavBlob = pcm16Base64ToWav(pcmBase64, 24000);
        const audioUrl = URL.createObjectURL(wavBlob);
        if (audioRef.current) {
          audioRef.current.src = audioUrl; audioRef.current.play();
          setIsJaneteSpeaking(true); audioRef.current.onended = () => setIsJaneteSpeaking(false);
        }
      }
    } catch (err) {}
  };

  // --- TRANSFORMAÇÕES DE IMAGEM NO GRID E SLIDER ---
  const handleGridMouseDown = (e, index) => {
    if (viewMode !== 'grid') return;
    setActivePanel(index);
    setDragStart({ x: e.clientX, y: e.clientY, origX: transforms[index].x, origY: transforms[index].y });
  };

  const handleGridMouseMove = (e) => {
    if (isDraggingLogo) {
      const rect = e.currentTarget.getBoundingClientRect();
      let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      let y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      setLogoState(prev => ({ ...prev, x: (x / rect.width) * 100, y: (y / rect.height) * 100 }));
      return;
    }
    if (viewMode === 'slider' && isDraggingCompare) {
      const rect = e.currentTarget.getBoundingClientRect();
      let x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      setComparePos((x / rect.width) * 100);
    } else if (viewMode === 'grid' && activePanel !== null && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      updateTransform(activePanel, { x: dragStart.origX + dx, y: dragStart.origY + dy });
    }
  };

  const handleGridMouseUp = () => {
    setIsDraggingCompare(false);
    setIsDraggingLogo(false);
    setDragStart(null);
  };

  const updateTransform = (index, newProps) => {
    setTransforms(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...newProps };
      return next;
    });
  };

  // --- GERAÇÃO DE CANVAS FINAL ---
  const generateGridCanvas = async () => {
    if (!originalImage) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const W = 1080; const H = 1350; const footerH = 200; const contentH = H - footerH;
    canvas.width = W; canvas.height = H;

    const loadImg = (src) => new Promise((resolve) => {
      const img = new Image(); img.onload = () => resolve(img); img.src = src;
    });

    const origImgObj = await loadImg(`data:image/jpeg;base64,${originalImage}`);
    const trueRatio = origImgObj.width / origImgObj.height;

    const tintImage = (imgSrc, color, w, h) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const offCanvas = document.createElement('canvas');
          offCanvas.width = w; offCanvas.height = h;
          const offCtx = offCanvas.getContext('2d');
          offCtx.drawImage(img, 0, 0, w, h);
          offCtx.globalCompositeOperation = 'source-in';
          offCtx.fillStyle = color;
          offCtx.fillRect(0, 0, w, h);
          resolve(offCanvas);
        };
        img.src = imgSrc;
      });
    };

    let logoCanvas = null;
    if (hairSettings.headband && logoState.image) {
       const scaleRatio = W / 450;
       const scaledSize = logoState.size * scaleRatio;
       logoCanvas = await tintImage(`data:image/png;base64,${logoState.image}`, logoState.color, scaledSize, scaledSize);
    }

    const imagesToDraw = [originalImage];
    for(let i=0; i < gridCount - 1; i++) { 
      if (i < sessions.length) imagesToDraw.push(sessions[i]);
      else if (i === sessions.length) imagesToDraw.push(previewImage || originalImage);
      else imagesToDraw.push(originalImage);
    }

    let rects = [];
    if (gridCount === 2) {
      rects = [{ x: 0, y: 0, w: W, h: contentH/2, label: "ANTES" }, { x: 0, y: contentH/2, w: W, h: contentH/2, label: "DEPOIS" }];
    } else if (gridCount === 3) {
      rects = [{ x: 0, y: 0, w: W, h: contentH/2, label: "ANTES" }, { x: 0, y: contentH/2, w: W/2, h: contentH/2, label: "SESSÃO 1" }, { x: W/2, y: contentH/2, w: W/2, h: contentH/2, label: sessions.length >= 1 ? "SESSÃO 2" : "AGUARDANDO" }];
    } else if (gridCount === 4) {
      rects = [{ x: 0, y: 0, w: W/2, h: contentH/2, label: "ANTES" }, { x: W/2, y: 0, w: W/2, h: contentH/2, label: "SESSÃO 1" }, { x: 0, y: contentH/2, w: W/2, h: contentH/2, label: "SESSÃO 2" }, { x: W/2, y: contentH/2, w: W/2, h: contentH/2, label: sessions.length >= 2 ? "SESSÃO 3" : "AGUARDANDO" }];
    }

    ctx.fillStyle = '#000000'; 
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      const imgData = await loadImg(`data:image/png;base64,${imagesToDraw[i]}`);
      const t = transforms[i];

      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();

      const targetRatio = rect.w / rect.h;
      let drawW, drawH;
      if (trueRatio > targetRatio) {
        drawW = rect.w; drawH = drawW / trueRatio;
      } else {
        drawH = rect.h; drawW = drawH * trueRatio;
      }

      const centerX = rect.x + rect.w / 2;
      const centerY = rect.y + rect.h / 2;
      const scaleMult = W / 450; 

      ctx.translate(centerX + (t.x * scaleMult), centerY + (t.y * scaleMult));
      ctx.rotate((t.rot * Math.PI) / 180);
      ctx.scale(t.scale, t.scale);

      ctx.drawImage(imgData, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      if (logoCanvas && (i > 0 && hairSettings.headband)) {
        const lx = rect.x + (logoState.x / 100) * rect.w - logoCanvas.width / 2;
        const ly = rect.y + (logoState.y / 100) * rect.h - logoCanvas.height / 2;
        ctx.save();
        ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
        ctx.drawImage(logoCanvas, lx, ly);
        ctx.restore();
      }
    }

    if (showLine) {
      ctx.strokeStyle = '#eab308'; 
      ctx.lineWidth = 6;
      ctx.shadowColor = '#eab308'; ctx.shadowBlur = 10;
      ctx.beginPath();
      if (gridCount === 2) { ctx.moveTo(0, contentH/2); ctx.lineTo(W, contentH/2); }
      else if (gridCount === 3) { ctx.moveTo(0, contentH/2); ctx.lineTo(W, contentH/2); ctx.moveTo(W/2, contentH/2); ctx.lineTo(W/2, contentH); }
      else if (gridCount === 4) { ctx.moveTo(0, contentH/2); ctx.lineTo(W, contentH/2); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, contentH); }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.font = "bold 26px 'Arial Black', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    rects.forEach(rect => {
      const textW = ctx.measureText(rect.label).width;
      const boxW = textW + 40; const boxH = 46;
      let bx = rect.x + rect.w - boxW - 20;
      let by = rect.y + rect.h - boxH - 20;
      if ((gridCount === 2 || gridCount === 3) && rect.label === "ANTES") { by = rect.y + rect.h - boxH; bx = rect.x + rect.w - boxW - 50; }
      if (gridCount === 2 && rect.label !== "ANTES") { by = rect.y; bx = rect.x + rect.w - boxW - 50; }

      ctx.fillStyle = '#db2777'; 
      ctx.shadowColor = '#db2777'; ctx.shadowBlur = 15;
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff'; 
      ctx.fillText(rect.label, bx + boxW/2, by + boxH/2);
    });

    ctx.fillStyle = '#000000'; ctx.fillRect(0, H - footerH, W, footerH); 
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#eab308';
    ctx.font = "italic 80px 'Brush Script MT', 'Bradley Hand', cursive, serif";
    ctx.shadowColor = '#eab308'; ctx.shadowBlur = 20;
    ctx.fillText("ko", W / 2, H - footerH + 60);
    ctx.beginPath(); ctx.moveTo(W/2 - 80, H - footerH + 70); ctx.lineTo(W/2 + 90, H - footerH + 45);
    ctx.strokeStyle = '#db2777'; ctx.lineWidth = 3; ctx.stroke(); 
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = "300 24px sans-serif"; if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "8px"; 
    ctx.fillText("KAROLINE OLIVEIRA", W / 2 + 4, H - footerH + 130);
    ctx.font = "300 14px sans-serif"; if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "6px";
    ctx.fillStyle = '#eab308';
    ctx.fillText("BEAUTY", W / 2 + 3, H - footerH + 165);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = "0px";

    return canvas.toDataURL('image/png');
  };

  const handleSaveToCarousel = async () => {
    const dataUrl = await generateGridCanvas();
    if (dataUrl) setGallery([...gallery, dataUrl]);
  };

  const downloadCarousel = () => {
    gallery.forEach((dataUrl, index) => {
      const link = document.createElement('a'); link.download = `KarolineBeauty_Pagina_${index + 1}_${Date.now()}.png`; link.href = dataUrl;
      setTimeout(() => link.click(), index * 300); 
    });
  };

  return (
    <div className="min-h-screen bg-black text-neutral-100 font-sans flex flex-col h-screen overflow-hidden selection:bg-yellow-500/30">
      <audio ref={audioRef} className="hidden" />

      {/* --- ÁREA PRINCIPAL --- */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* --- SIDEBAR ESQUERDA (Upload & Janete) --- */}
        <div className="w-full md:w-80 bg-neutral-950 border-r border-yellow-500/30 flex flex-col shrink-0 z-10 h-full shadow-[5px_0_30px_rgba(234,179,8,0.05)]">
          <div className="p-5 pb-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                <Sparkle className="text-yellow-400 w-6 h-6" />
              </div>
              <h1 className="text-xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-pink-500">
                KAROLINE OS
              </h1>
            </div>

            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <button 
              onClick={() => fileInputRef.current.click()}
              className="w-full bg-neutral-900 hover:bg-yellow-500/10 border border-neutral-800 hover:border-yellow-500/50 text-white p-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 group mb-4 shadow-lg"
            >
              <Upload className="w-5 h-5 text-neutral-400 group-hover:text-yellow-400"/> 
              <span className="text-sm font-semibold tracking-wide group-hover:text-yellow-400">NOVO PACIENTE</span>
            </button>

            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-3 backdrop-blur-sm">
              <h3 className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest mb-2 flex items-center gap-2"><Grid className="w-3 h-3"/> Layout de Saída</h3>
              <div className="flex gap-1 mb-3">
                {[2, 3, 4].map(num => (
                  <button 
                    key={num} onClick={() => setGridCount(num)} 
                    className={`flex-1 text-[11px] py-1.5 rounded uppercase font-bold tracking-widest transition-all duration-300 ${gridCount === num ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]' : 'bg-neutral-950 text-neutral-500 border border-transparent hover:border-neutral-700'}`}
                  >
                    {num} PNL
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer font-medium uppercase tracking-wider">
                <input type="checkbox" checked={showLine} onChange={e => setShowLine(e.target.checked)} className="accent-pink-500 w-4 h-4" />
                Guias Divisórias Neon
              </label>
            </div>
          </div>

          <div className="flex-1 flex flex-col border-t border-neutral-800/50 bg-[#0a0a0a] min-h-[250px] relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(rgba(234,179,8,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(234,179,8,0.2)_1px,transparent_1px)] bg-[size:20px_20px]"></div>

            <div className="p-4 border-b border-[#1a1a1a] flex items-center gap-4 z-10 bg-[#0a0a0a]/80 backdrop-blur-md">
              <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
                <div className={`plasma-orb ${isJaneteSpeaking ? 'speaking' : ''} ${isJaneteThinking ? 'thinking' : ''}`}>
                   <div className="plasma-layer layer-1"></div>
                   <div className="plasma-layer layer-2"></div>
                   <div className="plasma-layer layer-3"></div>
                   <div className="orb-core"></div>
                </div>
              </div>
              
              <div>
                <h3 className="text-sm font-black text-yellow-500 tracking-widest uppercase flex items-center gap-2">J.A.N.E.T.E</h3>
                <p className="text-[9px] text-[#8b732b] uppercase tracking-widest font-mono">Core System / Online</p>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto custom-scrollbar space-y-3 z-10">
              {janeteChat.length === 0 && (
                <div className="text-[10px] text-[#8b732b] font-mono p-2 border border-[#2a2a2a] rounded bg-[#131313] text-center uppercase tracking-widest">
                  Sistema online, Sr. Percílio. <br/>Aguardando comandos verbais ou textuais.
                </div>
              )}
              {janeteChat.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] p-2 rounded-md text-[11px] leading-relaxed font-mono ${msg.role === 'user' ? 'bg-[#1a1a1a] text-neutral-300 border-r-2 border-yellow-500' : 'bg-[#131313] text-[#d4af37] border-l-2 border-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.05)]'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
            
            <form onSubmit={handleJaneteSubmit} className="p-4 border-t border-[#1a1a1a] bg-[#050505] flex gap-3 z-10 items-center">
              <input 
                type="text" value={janeteInput} onChange={e => setJaneteInput(e.target.value)}
                placeholder="Comando para J.A.N.E.T.E..."
                className="flex-1 bg-[#111] border border-[#2a2a2a] rounded-md px-4 py-3 text-xs focus:outline-none focus:border-yellow-600/50 text-[#d4af37] placeholder-[#8b732b] font-mono shadow-inner"
              />
              <button type="submit" disabled={isJaneteThinking || isGeneratingPatient || !janeteInput.trim()} className="bg-[#111] hover:bg-[#1a1a1a] border border-[#8b732b] text-[#d4af37] w-11 h-11 rounded-md flex items-center justify-center disabled:opacity-50 transition-all shadow-[0_0_10px_rgba(212,175,55,0.05)] shrink-0">
                <Mic className="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>

        {/* --- ÁREA CENTRAL: VISUALIZADOR --- */}
        <div className="flex-1 bg-black flex flex-col relative overflow-hidden" onMouseMove={handleGridMouseMove} onMouseUp={handleGridMouseUp} onMouseLeave={handleGridMouseUp}>
          
          <div className="w-full flex justify-between items-center p-3 px-5 border-b border-neutral-800/80 bg-neutral-950 z-40">
             <div className="flex gap-2">
               <button onClick={() => setViewMode('slider')} className={`flex items-center gap-2 px-4 py-1.5 rounded text-[10px] uppercase tracking-widest font-black transition-all ${viewMode === 'slider' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]' : 'text-neutral-500 hover:text-yellow-400 border border-transparent'}`}>
                 <SplitSquareHorizontal className="w-4 h-4" /> Edição Viva
               </button>
               <button onClick={() => setViewMode('grid')} className={`flex items-center gap-2 px-4 py-1.5 rounded text-[10px] uppercase tracking-widest font-black transition-all ${viewMode === 'grid' ? 'bg-pink-500/20 text-pink-400 border border-pink-500/50 shadow-[0_0_10px_rgba(236,72,153,0.3)]' : 'text-neutral-500 hover:text-pink-400 border border-transparent'}`}>
                 <Grid className="w-4 h-4" /> HUD Grade
               </button>
             </div>
             <div className="text-[10px] font-mono tracking-widest text-neutral-500">
                SLOTS <span className="text-yellow-400 font-bold">{sessions.length}</span> / {gridCount - 1}
             </div>
          </div>

          {errorMsg && (
            <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-red-950/90 text-red-400 border border-red-500/50 px-6 py-2 rounded flex items-center gap-2 z-50 shadow-[0_0_20px_rgba(239,68,68,0.4)] font-mono text-xs">
              <AlertCircle className="w-4 h-4 shrink-0"/> <span className="truncate">{typeof errorMsg === 'string' ? errorMsg : "Erro de sistema"}</span>
            </div>
          )}

          <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-neutral-900 via-black to-black">
              
              {isGeneratingPatient ? (
                <div className="text-center text-neutral-400 w-full max-w-xl aspect-[4/5] rounded-xl border border-pink-500/30 flex flex-col items-center justify-center bg-neutral-900/40 backdrop-blur-md shadow-[0_0_50px_rgba(236,72,153,0.1)]">
                  <div className="relative w-20 h-20 mb-6">
                     <div className="absolute inset-0 border-4 border-t-pink-500 border-r-transparent border-b-yellow-500 border-l-transparent rounded-full animate-spin"></div>
                     <div className="absolute inset-2 border-4 border-t-yellow-500 border-r-transparent border-b-pink-500 border-l-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
                     <Sparkle className="w-6 h-6 text-yellow-400 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <p className="text-xs font-mono uppercase tracking-widest text-pink-400 font-bold">Iniciando Biogênese Digital</p>
                  <p className="text-[10px] font-mono text-neutral-500 mt-2">Sintetizando estrutura anatômica...</p>
                </div>
              ) : !originalImage ? (
                <div className="text-center text-neutral-600 w-full max-w-xl aspect-[4/5] rounded-xl border border-neutral-800 flex flex-col items-center justify-center bg-neutral-900/20 backdrop-blur-sm">
                  <div className="p-6 rounded-full border border-neutral-800 border-dashed mb-4">
                     <ImageIcon className="w-12 h-12 opacity-30" />
                  </div>
                  <p className="text-xs font-mono uppercase tracking-widest">Aguardando Input de Imagem</p>
                  <p className="text-[10px] text-neutral-500 mt-4 max-w-xs leading-relaxed">Faça upload de uma foto do paciente ou peça à J.A.N.E.T.E. para gerar uma modelo virtual do zero.</p>
                </div>
              ) : viewMode === 'slider' ? (
                
                /* MODO SLIDER (LIVE PREVIEW COM BASE FIXA E CORREÇÃO DE OBJECT-COVER) */
                <div className="relative w-full max-w-[450px] bg-black border border-neutral-800 shadow-[0_0_40px_rgba(0,0,0,0.8)] flex items-center justify-center overflow-hidden" style={{ maxHeight: '100%' }}>
                  
                  {/* WRAPPER GHOST: Ocupa o tamanho correto da foto original. */}
                  <div 
                    className="relative inline-block max-w-full max-h-full cursor-ew-resize select-none touch-none" 
                    onMouseMove={handleGridMouseMove} 
                    onTouchMove={(e) => { 
                      if (!isDraggingCompare && !isDraggingLogo) return; 
                      if(isDraggingLogo) { 
                        const rect = e.currentTarget.getBoundingClientRect(); 
                        setLogoState(prev => ({...prev, x: (Math.max(0, Math.min(e.touches[0].clientX - rect.left, rect.width))/rect.width)*100, y: (Math.max(0, Math.min(e.touches[0].clientY - rect.top, rect.height))/rect.height)*100})); 
                        return; 
                      } 
                      const rect = e.currentTarget.getBoundingClientRect(); 
                      setComparePos((Math.max(0, Math.min(e.touches[0].clientX - rect.left, rect.width)) / rect.width) * 100); 
                    }} 
                    onMouseDown={() => setIsDraggingCompare(true)} 
                    onTouchStart={() => setIsDraggingCompare(true)} 
                    onMouseUp={handleGridMouseUp} 
                    onMouseLeave={handleGridMouseUp} 
                    onTouchEnd={handleGridMouseUp}
                  >
                    
                    {/* MOLDE ORIGINAL INVISÍVEL (Garante a proporção geométrica da Div Contentora) */}
                    <img src={`data:image/jpeg;base64,${originalImage}`} className="w-full h-full opacity-0 pointer-events-none block" style={{ objectFit: 'contain' }} draggable={false} alt="" />
                    
                    {/* IMAGEM PREVIEW (Usa object-cover para não esmagar caso a IA gere formato quadrado) */}
                    <div className="absolute inset-0">
                      <img src={`data:image/png;base64,${previewImage || originalImage}`} className={`w-full h-full transition-all duration-300 ${isProcessing ? 'opacity-80 brightness-50' : ''}`} style={{ objectFit: 'cover', objectPosition: 'center' }} draggable={false} alt="Preview" />
                      
                      {/* Logo arrastável sobre o 'Depois' */}
                      {(previewImage || sessions.length > 0) && hairSettings.headband && coloredLogoUrl && (
                        <img 
                            src={coloredLogoUrl} 
                            onMouseDown={(e) => { e.stopPropagation(); setIsDraggingLogo(true); }}
                            style={{ position: 'absolute', top: `${logoState.y}%`, left: `${logoState.x}%`, width: `${logoState.size}%`, transform: 'translate(-50%, -50%)', cursor: 'move', zIndex: 15 }} 
                            draggable={false} alt="Logo"
                        />
                      )}
                    </div>

                    {/* IMAGEM ORIGINAL (Para Cortina do Slider com object-cover sincronizado) */}
                    <div className="absolute inset-0 z-10" style={{ clipPath: `polygon(0 0, ${comparePos}% 0, ${comparePos}% 100%, 0 100%)` }}>
                      <img src={`data:image/jpeg;base64,${originalImage}`} className="w-full h-full pointer-events-none block" style={{ objectFit: 'cover', objectPosition: 'center' }} draggable={false} alt="Original" />
                    </div>

                    <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 shadow-[0_0_15px_#facc15] z-20 flex items-center justify-center" style={{ left: `calc(${comparePos}% - 1px)` }}>
                      <div className="w-6 h-6 bg-black border-2 border-yellow-400 text-yellow-400 rounded-full flex items-center justify-center shadow-[0_0_10px_#facc15] transform -translate-x-[11px]">
                        <ChevronsLeftRight className="w-3 h-3" />
                      </div>
                    </div>

                    {isProcessing && (
                      <>
                        <div className="absolute inset-0 bg-yellow-500/10 z-30 pointer-events-none"></div>
                        <div className="scanner-line"></div>
                        <div className="absolute bottom-4 right-4 bg-black/80 border border-yellow-500 text-yellow-400 px-3 py-1 rounded text-[10px] font-bold tracking-widest font-mono z-40 flex items-center gap-2">
                           <Wand2 className="w-3 h-3 animate-spin" /> RENDERIZANDO...
                        </div>
                      </>
                    )}
                    
                    {!isProcessing && (
                      <>
                        <div className="absolute top-4 left-4 bg-black/80 border border-neutral-700 text-neutral-300 px-2 py-1 rounded text-[10px] font-bold z-30 font-mono tracking-widest pointer-events-none shadow-md">
                          ORIGINAL
                        </div>
                        {previewImage && (
                          <div className="absolute top-4 right-4 bg-yellow-950/80 border border-yellow-500 text-yellow-400 px-2 py-1 rounded text-[10px] font-bold z-30 font-mono tracking-widest pointer-events-none shadow-[0_0_10px_rgba(234,179,8,0.2)]">
                            LIVE PREVIEW
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                /* MODO GRADE HUD COM ESPELHAMENTO DE PREVIEW */
                <div className="relative w-full max-w-[450px] bg-black shadow-[0_0_40px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col border border-neutral-800" style={{ aspectRatio: gridCount === 2 ? 'auto' : '4/5', maxHeight: '100%' }}>
                  
                  <div className={`flex-1 grid w-full h-full bg-black ${showLine ? 'gap-1' : ''}`} 
                       style={{ gridTemplateColumns: gridCount === 4 ? '1fr 1fr' : '1fr', gridTemplateRows: gridCount === 2 ? '1fr 1fr' : (gridCount === 3 ? '1fr 1fr' : '1fr 1fr') }}>
                    
                    {Array.from({length: gridCount}).map((_, index) => {
                      let imgSource;
                      let panelLabel = "";

                      if (index === 0) {
                        imgSource = originalImage;
                        panelLabel = "ANTES";
                      } else if (index - 1 < sessions.length) {
                        imgSource = sessions[index - 1];
                        panelLabel = gridCount === 2 ? "DEPOIS" : `SESSÃO ${index}`;
                      } else if (index - 1 === sessions.length) {
                        imgSource = previewImage || originalImage;
                        panelLabel = gridCount === 2 ? "DEPOIS" : "PREVIEW";
                      } else {
                        imgSource = originalImage;
                        panelLabel = "AGUARDANDO";
                      }

                      const t = transforms[index];
                      const isTarget = activePanel === index;
                      const isEditingSlot = (index - 1) === sessions.length;

                      return (
                        <div 
                          key={index}
                          className={`relative overflow-hidden bg-neutral-900 group flex items-center justify-center ${isEditingSlot && previewImage ? 'ring-2 ring-inset ring-yellow-500 shadow-[inset_0_0_20px_rgba(234,179,8,0.5)]' : ''}`}
                          style={{ gridColumn: (gridCount === 3 && index === 0) ? '1 / span 2' : 'auto' }}
                          onMouseDown={(e) => handleGridMouseDown(e, index)}
                          onMouseMove={handleGridMouseMove}
                          onMouseUp={handleGridMouseUp}
                          onMouseLeave={handleGridMouseUp}
                        >
                           <div style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale}) rotate(${t.rot}deg)`, display: 'inline-block', position: 'relative', maxWidth: '100%', maxHeight: '100%' }}>
                             {/* MOLDE INVISIVEL PARA PROPORÇÕES CORRETAS NA GRELHA */}
                             <img src={`data:image/jpeg;base64,${originalImage}`} className="max-w-full max-h-full opacity-0 pointer-events-none block" style={{ objectFit: 'contain' }} draggable={false} alt="" />
                             
                             <img 
                               src={`data:image/png;base64,${imgSource}`} 
                               className={`absolute top-0 left-0 w-full h-full ${isProcessing && isEditingSlot ? 'opacity-50 grayscale' : ''}`} 
                               style={{ objectFit: 'cover', objectPosition: 'center' }}
                               draggable={false} alt={panelLabel}
                             />
                             {index > 0 && hairSettings.headband && coloredLogoUrl && (
                                <img 
                                    src={coloredLogoUrl} 
                                    onMouseDown={(e) => { e.stopPropagation(); setIsDraggingLogo(true); }}
                                    style={{ position: 'absolute', top: `${logoState.y}%`, left: `${logoState.x}%`, width: `${logoState.size}%`, transform: 'translate(-50%, -50%)', cursor: 'move', zIndex: 50 }} 
                                    draggable={false} alt="Logo"
                                />
                             )}
                           </div>

                           <div className="absolute top-2 left-2 bg-black/80 border border-neutral-700/50 text-yellow-400 px-2 py-0.5 rounded text-[8px] font-bold font-mono pointer-events-none">
                             {panelLabel}
                           </div>

                           <div className={`absolute top-2 right-2 bg-black/80 backdrop-blur border border-neutral-700/50 p-1 rounded flex gap-1 transition-opacity ${isTarget ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              <button onClick={() => updateTransform(index, { scale: t.scale + 0.1 })} className="p-1 text-neutral-400 hover:text-yellow-400 bg-neutral-800/50 rounded" title="Zoom In"><Maximize className="w-3 h-3" /></button>
                              <button onClick={() => updateTransform(index, { scale: Math.max(0.5, t.scale - 0.1) })} className="p-1 text-neutral-400 hover:text-yellow-400 bg-neutral-800/50 rounded" title="Zoom Out"><Maximize className="w-3 h-3" style={{transform:'rotate(90deg)'}} /></button>
                              <button onClick={() => updateTransform(index, { rot: t.rot + 90 })} className="p-1 text-neutral-400 hover:text-pink-500 bg-neutral-800/50 rounded" title="Girar 90º"><RotateCw className="w-3 h-3" /></button>
                              <button onClick={() => updateTransform(index, defaultTransform)} className="p-1 text-neutral-400 hover:text-red-500 bg-neutral-800/50 rounded" title="Resetar Posicionamento"><RefreshCcw className="w-3 h-3" /></button>
                           </div>
                           
                           {isTarget && dragStart && !isDraggingLogo && (
                              <div className="absolute inset-0 border-2 border-yellow-500/50 pointer-events-none flex items-center justify-center bg-yellow-500/10">
                                <Hand className="w-8 h-8 text-yellow-400 opacity-50" />
                              </div>
                           )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="h-[15%] min-h-[60px] bg-black flex flex-col items-center justify-center text-white relative z-10 border-t border-yellow-500/30">
                     <div className="font-serif italic text-2xl mb-1 text-yellow-500" style={{textShadow: '0 0 10px #facc15'}}>ko</div>
                     <div className="text-[7px] tracking-[0.2em] font-light mt-1 text-neutral-300">KAROLINE OLIVEIRA BEAUTY</div>
                  </div>
                </div>
              )}
          </div>
        </div>

        {/* --- SIDEBAR DIREITA: Controles & Ações --- */}
        <div className="w-full md:w-[350px] bg-neutral-950 border-l border-yellow-500/30 flex flex-col h-full shrink-0 z-10 shadow-[-5px_0_30px_rgba(234,179,8,0.05)]">
          
          <div className="p-5 pb-0 border-b border-neutral-800">
             <div className="flex gap-2 mb-4">
               <button 
                 onClick={() => setSidebarTab('estetica')} 
                 className={`flex-1 py-2 rounded text-[10px] uppercase font-black tracking-widest transition-all ${sidebarTab === 'estetica' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.2)]' : 'bg-neutral-900 text-neutral-500 hover:text-yellow-400 border border-neutral-800'}`}
               >
                 Estética
               </button>
               <button 
                 onClick={() => setSidebarTab('realismo')} 
                 className={`flex-1 py-2 rounded text-[10px] uppercase font-black tracking-widest transition-all ${sidebarTab === 'realismo' ? 'bg-pink-500/20 text-pink-400 border border-pink-500/50 shadow-[0_0_10px_rgba(219,39,119,0.2)]' : 'bg-neutral-900 text-neutral-500 hover:text-pink-400 border border-neutral-800'}`}
               >
                 Realismo Engine
               </button>
             </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar flex flex-col">
            
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[11px] font-black text-neutral-400 uppercase tracking-widest flex items-center gap-2">
                <Sliders className="w-3 h-3 text-yellow-500" /> Controlo Global
              </h2>
              <div className="flex gap-2">
                 <button onClick={() => {setAdjustments(defaultAdjustments); setRealismSettings(defaultRealism); setBgSettings({type:'original', color:'#eab308'}); setHairSettings(defaultHairSettings); setPreviewImage(null); setHasPendingChanges(false);}} className="text-neutral-500 hover:text-yellow-400 p-1.5 bg-neutral-900 border border-neutral-800 rounded transition-colors" title="Resetar Parâmetros"><Eraser className="w-3 h-3" /></button>
                 <button onClick={() => {setSessions([]); setPreviewImage(null); setHasPendingChanges(false);}} className="text-neutral-500 hover:text-red-500 p-1.5 bg-neutral-900 border border-neutral-800 rounded transition-colors" title="Apagar Camadas e Recomeçar"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>

            <div className="flex-1">
              {sidebarTab === 'estetica' ? (
                 <>
                    {/* SEÇÃO CAPILAR & ACESSÓRIOS */}
                    <div className="mb-5 space-y-3">
                       <h3 className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest border-b border-neutral-800 pb-1">Estilização Capilar & Acessórios</h3>
                       
                       <div className="bg-neutral-900/50 border border-neutral-800 p-3 rounded space-y-3">
                         <div className="grid grid-cols-2 gap-2">
                           <div>
                             <label className="text-[9px] text-neutral-400 uppercase tracking-wider block mb-1">Cor</label>
                             <select value={hairSettings.color} onChange={e => setHairSettings({...hairSettings, color: e.target.value})} className="w-full bg-neutral-950 border border-neutral-700 rounded p-1 text-[10px] text-neutral-300 focus:outline-none focus:border-yellow-500 font-mono">
                               <option value="original">Original</option>
                               <option value="loiro">Loiro</option>
                               <option value="castanho">Castanho</option>
                               <option value="preto">Preto</option>
                               <option value="ruivo">Ruivo</option>
                               <option value="platinado">Platinado</option>
                             </select>
                           </div>
                           <div>
                             <label className="text-[9px] text-neutral-400 uppercase tracking-wider block mb-1">Estilo</label>
                             <select value={hairSettings.style} onChange={e => setHairSettings({...hairSettings, style: e.target.value})} className="w-full bg-neutral-950 border border-neutral-700 rounded p-1 text-[10px] text-neutral-300 focus:outline-none focus:border-yellow-500 font-mono">
                               <option value="original">Original</option>
                               <option value="liso">Liso</option>
                               <option value="ondulado">Ondulado</option>
                               <option value="cacheado">Cacheado</option>
                               <option value="crespo">Crespo</option>
                             </select>
                           </div>
                           <div>
                             <label className="text-[9px] text-neutral-400 uppercase tracking-wider block mb-1">Tamanho</label>
                             <select value={hairSettings.length} onChange={e => setHairSettings({...hairSettings, length: e.target.value})} className="w-full bg-neutral-950 border border-neutral-700 rounded p-1 text-[10px] text-neutral-300 focus:outline-none focus:border-yellow-500 font-mono">
                               <option value="original">Original</option>
                               <option value="curto">Curto</option>
                               <option value="médio">Médio</option>
                               <option value="longo">Longo</option>
                             </select>
                           </div>
                           <div>
                             <label className="text-[9px] text-neutral-400 uppercase tracking-wider block mb-1">Corte</label>
                             <select value={hairSettings.cut} onChange={e => setHairSettings({...hairSettings, cut: e.target.value})} className="w-full bg-neutral-950 border border-neutral-700 rounded p-1 text-[10px] text-neutral-300 focus:outline-none focus:border-yellow-500 font-mono">
                               <option value="original">Original</option>
                               <option value="bob">Bob</option>
                               <option value="camadas">Camadas</option>
                               <option value="franja">Franja</option>
                               <option value="pixie">Pixie</option>
                             </select>
                           </div>
                         </div>
                         
                         <div className="border-t border-neutral-800 pt-2 mt-2 space-y-3">
                           <label className="flex items-center gap-2 text-[10px] text-neutral-300 cursor-pointer font-medium uppercase tracking-wider">
                             <input type="checkbox" checked={hairSettings.headband} onChange={e => setHairSettings({...hairSettings, headband: e.target.checked})} className="accent-pink-500 w-3 h-3" />
                             Faixa de Testa (Clínica)
                           </label>
                           
                           {hairSettings.headband && (
                              <div className="pl-5 space-y-3 border-l-2 border-yellow-500/30">
                                 <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-neutral-400 uppercase font-bold">Cor da Faixa</span>
                                    <input type="color" value={hairSettings.headbandColor} onChange={e => setHairSettings({...hairSettings, headbandColor: e.target.value})} className="w-6 h-6 rounded cursor-pointer border-none bg-transparent" />
                                 </div>
                                 
                                 <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-neutral-400 uppercase font-bold">Upload Logo</span>
                                    <button onClick={() => logoInputRef.current?.click()} className="text-[9px] bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-3 py-1 rounded text-yellow-400 transition-colors uppercase tracking-widest font-bold">Importar</button>
                                    <input type="file" accept="image/*" ref={logoInputRef} onChange={handleLogoUpload} className="hidden" />
                                 </div>

                                 {logoState.image && (
                                   <>
                                     <div className="flex items-center justify-between">
                                        <span className="text-[9px] text-neutral-400 uppercase font-bold">Cor do Logo</span>
                                        <input type="color" value={logoState.color} onChange={e => setLogoState({...logoState, color: e.target.value})} className="w-6 h-6 rounded cursor-pointer border-none bg-transparent" />
                                     </div>
                                     <div className="flex items-center gap-2">
                                        <span className="text-[8px] text-neutral-500 uppercase font-bold w-12">Tamanho</span>
                                        <input type="range" min="5" max="50" value={logoState.size} onChange={e => setLogoState({...logoState, size: parseInt(e.target.value)})} className="flex-1 accent-pink-500 h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer" />
                                     </div>
                                     <p className="text-[8px] text-neutral-500 uppercase mt-1 leading-tight">Arraste o logo sobre a foto para posicionar.</p>
                                   </>
                                 )}
                              </div>
                           )}
                         </div>
                       </div>
                    </div>

                    {/* SEÇÃO AMBIENTE & FUNDO */}
                    <div className="mb-5 space-y-3">
                       <h3 className="text-[9px] font-bold text-neutral-500 uppercase tracking-widest border-b border-neutral-800 pb-1">Ambiente Visual</h3>
                       
                       <div className="bg-neutral-900/50 border border-neutral-800 p-3 rounded">
                         <label className="text-[10px] text-neutral-400 uppercase tracking-wider block mb-2">Plano de Fundo</label>
                         <div className="flex gap-2 mb-2">
                           <select value={bgSettings.type} onChange={e => setBgSettings({...bgSettings, type: e.target.value})} className="flex-1 bg-neutral-950 border border-neutral-700 rounded p-1.5 text-[11px] text-neutral-300 focus:outline-none focus:border-yellow-500 font-mono">
                             <option value="original">Manter Original</option>
                             <option value="bokeh">Desfoque Óptico (Bokeh)</option>
                             <option value="neutral">Estúdio (Cinza Neutro)</option>
                             <option value="color">Cor Sólida Customizada</option>
                           </select>
                           {bgSettings.type === 'color' && (
                             <input type="color" value={bgSettings.color} onChange={e => setBgSettings({...bgSettings, color: e.target.value})} className="w-8 h-8 rounded cursor-pointer border-none bg-transparent" />
                           )}
                         </div>
                         
                         <div className="mt-4">
                           <div className="flex justify-between items-end mb-1">
                              <label className="text-[10px] text-neutral-400 uppercase tracking-wider">Iluminação Facial</label>
                              <span className="text-[9px] font-mono text-yellow-400 bg-yellow-950/50 px-1 rounded">{adjustments.lighting > 0 ? '+' : ''}{adjustments.lighting}</span>
                           </div>
                           <div className="flex items-center gap-2">
                              <span className="text-[8px] text-neutral-600 w-12 text-right uppercase">Dramática</span>
                              <input type="range" min="-100" max="100" value={adjustments.lighting} onChange={e => setAdjustments({...adjustments, lighting: parseInt(e.target.value)})} className="flex-1 h-1 rounded-lg appearance-none bg-neutral-800 accent-yellow-400 cursor-pointer" />
                              <span className="text-[8px] text-neutral-600 w-12 uppercase">Brilhante</span>
                           </div>
                         </div>
                       </div>
                    </div>

                    {/* ACORDEÕES DE ESTÉTICA */}
                    {aestheticLayers.map(layer => (
                     <div key={layer.id} className={`bg-neutral-900/50 border ${activeAestheticLayer === layer.id ? layer.theme.border : 'border-neutral-800'} rounded overflow-hidden transition-colors mb-3`}>
                       <button 
                         className={`w-full text-left p-3 text-[10px] font-bold uppercase tracking-widest flex justify-between items-center transition-colors ${activeAestheticLayer === layer.id ? layer.theme.text : 'text-neutral-400 hover:text-white'}`}
                         onClick={() => setActiveAestheticLayer(activeAestheticLayer === layer.id ? null : layer.id)}
                       >
                         <span>{layer.title}</span>
                         <span className="text-lg font-mono leading-none">{activeAestheticLayer === layer.id ? '-' : '+'}</span>
                       </button>
                       {activeAestheticLayer === layer.id && (
                         <div className="p-4 border-t border-neutral-800/50 space-y-4 bg-black/30">
                            {layer.items.map(adj => (
                               <div key={adj.id} className="relative group">
                                 <div className="flex justify-between items-end mb-1">
                                   <label className="text-[9px] font-medium text-neutral-300 uppercase tracking-wider">{adj.label}</label>
                                   <span className={`text-[8px] font-mono ${layer.theme.text} ${layer.theme.bg} px-1.5 rounded border ${layer.theme.border}`}>
                                     {adjustments[adj.id]}%
                                   </span>
                                 </div>
                                 <input type="range" min="0" max="100" value={adjustments[adj.id]} onChange={e => setAdjustments({...adjustments, [adj.id]: parseInt(e.target.value)})} className={`w-full h-1 rounded-lg appearance-none bg-neutral-800 ${layer.theme.accent} outline-none cursor-pointer`} />
                               </div>
                            ))}
                         </div>
                       )}
                     </div>
                   ))}
                 </>
              ) : (
                 <div className="space-y-3">
                   <div className="text-[9px] text-pink-500 bg-pink-500/10 p-2 rounded border border-pink-500/20 uppercase tracking-widest text-center font-bold flex items-center justify-center gap-1 mb-4">
                      <Fingerprint className="w-3 h-3" /> Módulo de Hiper-Realismo Ativado
                   </div>
                   {realismLayers.map(layer => (
                     <div key={layer.id} className={`bg-neutral-900/50 border ${activeRealismLayer === layer.id ? layer.theme.border : 'border-neutral-800'} rounded overflow-hidden transition-colors`}>
                       <button 
                         className={`w-full text-left p-3 text-[10px] font-bold uppercase tracking-widest flex justify-between items-center transition-colors ${activeRealismLayer === layer.id ? layer.theme.text : 'text-neutral-400 hover:text-white'}`}
                         onClick={() => setActiveRealismLayer(activeRealismLayer === layer.id ? null : layer.id)}
                       >
                         <span>{layer.title}</span>
                         <span className="text-lg font-mono leading-none">{activeRealismLayer === layer.id ? '-' : '+'}</span>
                       </button>
                       {activeRealismLayer === layer.id && (
                         <div className="p-4 border-t border-neutral-800/50 space-y-4 bg-black/30">
                            {layer.items.map(adj => (
                               <div key={adj.id} className="relative group">
                                 <div className="flex justify-between items-end mb-1">
                                   <label className="text-[9px] font-medium text-neutral-300 uppercase tracking-wider">{adj.label}</label>
                                   <span className={`text-[8px] font-mono ${layer.theme.text} ${layer.theme.bg} px-1.5 rounded border ${layer.theme.border}`}>
                                     {realismSettings[adj.id]}%
                                   </span>
                                 </div>
                                 <input type="range" min="0" max="100" value={realismSettings[adj.id]} onChange={e => setRealismSettings({...realismSettings, [adj.id]: parseInt(e.target.value)})} className={`w-full h-1 rounded-lg appearance-none bg-neutral-800 ${layer.theme.accent} outline-none cursor-pointer`} />
                               </div>
                            ))}
                         </div>
                       )}
                     </div>
                   ))}
                 </div>
              )}
            </div>

            {/* BOTÕES DE AÇÃO INFERIORES */}
            <div className="mt-8 space-y-3">
              {hasPendingChanges && (
                <div className="text-[9px] text-yellow-400 mb-1 font-mono text-center animate-pulse uppercase tracking-widest">
                  * Existem alterações pendentes *
                </div>
              )}
              <button 
                onClick={() => generatePreview(adjustments, realismSettings, bgSettings, hairSettings)}
                disabled={isProcessing || !originalImage || (!hasPendingChanges && previewImage !== null)}
                className={`w-full py-3 rounded font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(219,39,119,0.2)] disabled:opacity-50 ${hasPendingChanges ? 'bg-pink-600 hover:bg-pink-500 text-white ring-2 ring-pink-500/50 ring-offset-2 ring-offset-black' : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700'}`}
              >
                <Wand2 className="w-4 h-4"/> {isProcessing ? 'PROCESSANDO...' : 'APLICAR ALTERAÇÕES'}
              </button>

              <button 
                onClick={commitToGrid}
                disabled={isProcessing || !previewImage || sessions.length >= gridCount - 1}
                className="w-full bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/50 text-yellow-400 py-3 rounded font-black text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(234,179,8,0.2)] hover:shadow-[0_0_20px_rgba(234,179,8,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {sessions.length >= gridCount - 1 ? (
                  "GRADE CHEIA"
                ) : (
                  <><Check className="w-4 h-4"/> FIXAR NA GRADE (SLOT {sessions.length + 2})</>
                )}
              </button>
            </div>
          </div>

          <div className="p-4 border-t border-neutral-800 bg-neutral-950/50 backdrop-blur-md">
             <button 
              onClick={handleSaveToCarousel}
              disabled={!originalImage || isProcessing}
              className="w-full bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/50 text-pink-400 p-3 rounded font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-30 shadow-[0_0_15px_rgba(219,39,119,0.2)] mb-1"
            >
              <Layers className="w-4 h-4"/> SALVAR GRADE NO CARROSSEL
            </button>
          </div>
        </div>
      </div>

      {/* --- RODAPÉ: GALERIA DE CARROSSEL --- */}
      <div className="h-32 bg-black border-t border-yellow-500/30 flex items-center px-6 gap-6 z-20 shrink-0 shadow-[0_-5px_30px_rgba(234,179,8,0.05)]">
         <div className="flex flex-col items-start w-48 shrink-0">
           <h3 className="text-xs font-black text-yellow-400 mb-1 uppercase tracking-widest">Memória de Exportação</h3>
           <p className="text-[9px] text-neutral-500 mb-3 font-mono uppercase">{gallery.length} Blocos Prontos.</p>
           <button 
             onClick={downloadCarousel}
             disabled={gallery.length === 0}
             className="w-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-white p-2 rounded text-[10px] uppercase tracking-widest font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
           >
             <Download className="w-3 h-3"/> EXECUTAR DOWNLOAD
           </button>
         </div>

         <div className="flex-1 flex gap-3 overflow-x-auto pb-2 pt-2 custom-scrollbar h-full items-center">
            {gallery.length === 0 ? (
               <div className="text-[10px] text-neutral-600 font-mono uppercase tracking-widest border border-neutral-800 border-dashed p-4 rounded w-full text-center bg-neutral-900/20">Buffer Vazio. Adicione páginas.</div>
            ) : (
               gallery.map((dataUrl, idx) => (
                 <div key={idx} className="relative h-[90%] aspect-[4/5] bg-black border border-yellow-500/50 rounded overflow-hidden group shrink-0 shadow-[0_0_15px_rgba(234,179,8,0.1)] hover:shadow-[0_0_20px_rgba(236,72,153,0.3)] transition-all">
                   <img src={dataUrl} className="w-full h-full object-cover" alt={`Página ${idx + 1}`} />
                   <div className="absolute top-1 left-1 bg-black/80 border border-yellow-500/50 text-yellow-400 px-1.5 py-0.5 rounded text-[8px] font-mono tracking-widest">BLK-{idx + 1}</div>
                   <div className="absolute inset-0 bg-neutral-950/80 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                     <button onClick={() => setFullscreenImage(dataUrl)} className="p-2 bg-yellow-500 hover:bg-yellow-400 text-black rounded-full shadow-lg" title="Ampliar Imagem">
                       <Eye className="w-4 h-4" />
                     </button>
                     <button onClick={() => setGallery(gallery.filter((_, i) => i !== idx))} className="p-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-pink-500 rounded-full shadow-lg" title="Remover Página">
                       <Trash2 className="w-4 h-4" />
                     </button>
                   </div>
                 </div>
               ))
            )}
         </div>
      </div>

      {/* MODAL DE VISUALIZAÇÃO AMPLIADA (FULLSCREEN) */}
      {fullscreenImage && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setFullscreenImage(null)}>
          <button onClick={() => setFullscreenImage(null)} className="absolute top-6 right-6 text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 p-2 rounded-full transition-colors z-50 shadow-[0_0_15px_rgba(236,72,153,0.3)]">
            <X className="w-6 h-6" />
          </button>
          <img src={fullscreenImage} className="max-w-full max-h-full object-contain rounded shadow-[0_0_50px_rgba(234,179,8,0.2)]" onClick={(e) => e.stopPropagation()} alt="Visualização ampliada" />
        </div>
      )}
    </div>
  );
}
