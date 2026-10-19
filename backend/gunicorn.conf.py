# 单个进程 + 4 个线程适合当前低访问量站点，视频通过文件流发送。
bind = "127.0.0.1:8000"
workers = 1
worker_class = "gthread"
threads = 4
timeout = 120
accesslog = "-"
errorlog = "-"
