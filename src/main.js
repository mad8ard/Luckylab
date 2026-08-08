import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/base.css'
import './styles/chart.css'
import './styles/decision.css'
import './styles/replay.css'
import './styles/status.css'

createApp(App).use(createPinia()).mount('#app')
