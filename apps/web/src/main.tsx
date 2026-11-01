import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connectFirebase } from './lib/firebase';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<main className="auth"><p className="loading">Opening CoCo…</p></main>);
connectFirebase().then(firebase=>root.render(<App firebase={firebase}/>)).catch(error=>{
  root.render(<main className="auth"><div className="auth-card"><h1>A connection is missing.</h1><p>{error.message}</p><p>For local development, run the Firebase emulators and set VITE_USE_EMULATORS=true.</p><a href="https://github.com/Jorya-Design/CoCo">Open setup instructions →</a></div></main>);
});
