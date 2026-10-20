# Собирает index.html из src/stoika.html: добавляет Telegram, настройки и слой базы
import re
cfg=open('app/config.js').read();shim=open('app/shim.js').read();s=open('src/stoika.html').read()
s=s.replace('<title>','<script src="https://telegram.org/js/telegram-web-app.js"></script>\n<title>',1)
m=re.search(r'<script>',s);i=m.start()
s=s[:i]+'<script>'+cfg+'</script>\n<script>'+shim+'</script>\n'+s[i:]
open('index.html','w').write(s);open('.nojekyll','w').write('')
print('index.html',len(s))
