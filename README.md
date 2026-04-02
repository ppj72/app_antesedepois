# Karoline Beauty OS

Sistema avançado de edição de imagens com IA para harmonização facial.

## 🚀 Deploy

### Deploy no Vercel (Recomendado)

1. Acesse https://vercel.com/new
2. Importe seu repositório do GitHub
3. O Vercel detectará automaticamente (Create React App)
4. Clique **Deploy**

### Deploy Manual

```bash
npm install
npm run build
```

## ⚙️ Configuração da API

Edite o arquivo `src/App.js` e adicione sua API key na linha 8:

```javascript
const apiKey = "SUA_API_KEY_AQUI"; 
```

## 📦 Estrutura do Projeto

```
├── public/
│   └── index.html
├── src/
│   ├── App.js        # Componente principal
│   ├── index.js      # Entry point
│   └── index.css     # Estilos globais
├── package.json
├── tailwind.config.js
└── postcss.config.js
```

## 🛠️ Desenvolvimento

```bash
npm install
npm start
```

Abra [http://localhost:3000](http://localhost:3000) no navegador.

## 📝 Licença

© Karoline Oliveira Beauty
