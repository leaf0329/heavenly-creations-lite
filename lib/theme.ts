export const THEME_STORAGE_KEY = 'meika-theme'
export const THEME_BOOTSTRAP_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem('meika-theme')}catch(e){}var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.dataset.theme=d?'dark':'light';r.style.colorScheme=d?'dark':'light'})()`
