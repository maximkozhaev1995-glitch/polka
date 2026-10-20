# Собирает karta/index.html: каталог вкусов (все 570 с категориями) вшивается в страницу, а наличие и миксы карта берёт из базы при открытии.
# Нужен токен Supabase в SUPABASE_ACCESS_TOKEN. Шаблон страницы: karta/template.html.
import json,os,re,sys,urllib.request
sys.path.insert(0,os.path.dirname(__file__))
from classify import classify
T=os.environ['SUPABASE_ACCESS_TOKEN'];REF='wwcgvwfmlkegaqkksujo';VENUE='e58bb6aa-8a0e-4697-9ef6-0bc001f0e21e'
def sql(q):
    req=urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',data=json.dumps({'query':q}).encode(),headers={'Authorization':'Bearer '+T,'Content-Type':'application/json','User-Agent':'polka'},method='POST')
    return json.loads(urllib.request.urlopen(req,timeout=90).read())
root=os.path.join(os.path.dirname(__file__),'..')
st=json.loads(re.search(r'const DATA=(\[.*?\]);\n',open(root+'/src/stoika.html').read()).group(1))
status={x['id']:x.get('s') for x in st}
rows=sql(f"select f.id,f.brand b,f.line l,f.name n,f.descr d,f.tags t,f.strength st,coalesce(s.bar and not s.stop and not s.retired,false) ob,coalesce(s.slow,false) sl from flavors f left join stock s on s.flavor_id=f.id and s.venue_id='{VENUE}' where not f.custom")
G=[]
for r in rows:
    d='' if status.get(r['id'])=='pend' else (r['d'] or '')
    g={'id':r['id'],'b':r['b'],'l':r['l'] or '','n':r['n'],'d':d,'t':r['t'] or [],'ob':bool(r['ob'])}
    if r['sl']:g['sl']=True
    if r['st']:g['st']=r['st']
    g['c']=classify(g);G.append(g)
s=open(root+'/karta/template.html').read().replace('__DATA__',json.dumps(G,ensure_ascii=False))
open(root+'/karta/index.html','w').write(s)
print('karta/index.html',len(G),'вкусов, на стойке по снимку',sum(1 for g in G if g['ob']))
