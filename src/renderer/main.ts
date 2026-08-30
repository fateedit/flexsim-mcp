import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/theme.css'
import { setLogSink } from './api/webserver'
import { useLogs } from './stores/logs'

const app = createApp(App)
app.use(createPinia())

// 把 WebServer 每次请求的结果汇入日志 store
setLogSink((entry) => useLogs().add(entry))

app.mount('#app')
