import re, json, html
import os
R=os.environ.get('FUNKY', os.path.expanduser('~/funky'))+'/Resources/ServerInfo/'
sel=json.load(open('gbsel.json'))
META={
 'Guidebook/Medical/Chemist.xml':('Chemist','chemist'),
 'Funkystation/Guidebook/Medical/ChemistSOP.xml':('Chemist SOP','sop'),
 'Guidebook/Medical/Medicine.xml':('Medicine','medicine'),
 'Guidebook/Medical/AdvancedBrute.xml':('Specialized brute','brute'),
 '_Goobstation/Guidebook/Medical/Medicalpatches.xml':('Patches','patches'),
 'Funkystation/Guidebook/ChemicalTabs/Reactions.xml':('Reactions','reactions'),
 'Guidebook/Medical/MedicalDoctor.xml':('Medical Doctor','doctor'),
 'Guidebook/Medical/Botanicals.xml':('Botanicals','botanicals'),
 'Guidebook/Medical/Cryogenics.xml':('Cryogenics','cryo'),
 'Guidebook/Medical/Medical.xml':('Medical','medical'),
}
LINKS={'Chemicals':'chemicals','ChemistSOP':'sop','Medicine':'medicine','Chemist':'chemist','CMOSOP':None,'DoctorSOP':None}
def inline(s):
    s=html.escape(s, quote=False)
    s=re.sub(r'\[textlink="([^"]*)" link="([^"]*)"\]', lambda m: f'<a class="gblink" data-page="{LINKS.get(m.group(2)) or ""}">{m.group(1)}</a>' if LINKS.get(m.group(2)) else m.group(1), s)
    s=re.sub(r'\[bolditalic\](.*?)\[/bolditalic\]', r'<b><i>\1</i></b>', s)
    s=re.sub(r'\[bold\](.*?)\[/bold\]', r'<b>\1</b>', s)
    s=re.sub(r'\[italic\](.*?)\[/italic\]', r'<i>\1</i>', s)
    s=re.sub(r'\[color=(#[0-9a-fA-F]{3,8}|[a-z]+)\](.*?)\[/color\]', lambda m: f'<span class="gbc gbc-{ {"red":"red","cyan":"cyan"}.get(m.group(1).lower(),"tint")}">{m.group(2)}</span>', s)
    s=s.replace('{1}','')
    return s
pages=[]
for p in sel['pages']:
    raw=open(R+p,encoding='utf-8').read()
    raw=re.sub(r'<!--.*?-->','',raw,flags=re.S)
    body=re.search(r'<Document>(.*)</Document>',raw,re.S).group(1)
    blocks=[]; box=None; para=[]
    def flush():
        global para
        if para: blocks.append({'t':'p','h':inline(' '.join(para))}); para=[]
    for line in body.split('\n'):
        l=line.strip()
        if not l: flush(); continue
        if l.startswith('<Box>'): flush(); box=[]; 
        if box is not None:
            for m in re.finditer(r'<GuideEntityEmbed\s+([^/]*)/>', l):
                a=dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
                box.append({'e':a.get('Entity'),'cap':a.get('Caption')})
            txt=re.sub(r'<[^>]+>','',l).strip()
            if txt: flush(); para.append(txt)
            if '</Box>' in l:
                if box: blocks.append({'t':'box','items':box})
                box=None; flush()
            continue
        m=re.match(r'<GuideReagentEmbed Reagent="(\w+)"\s*/>', l)
        if m: flush(); blocks.append({'t':'reagent','id':m.group(1)}); continue
        m=re.match(r'<GuideReagentGroupEmbed Group="(\w+)"\s*/>', l)
        if m: flush(); blocks.append({'t':'group','g':m.group(1)}); continue
        m=re.match(r'^(#{1,3})\s*(.+)$', l)
        if m: flush(); blocks.append({'t':'h%d'%len(m.group(1)),'h':inline(m.group(2))}); continue
        m=re.match(r'^(-|\d+\.)\s*(.+)$', l)
        if m: flush(); blocks.append({'t':'li','n':m.group(1) if m.group(1)!='-' else None,'h':inline(m.group(2))}); continue
        if l.startswith('<'): continue
        para.append(l)
    flush()
    title,slug=META[p]
    pages.append({'slug':slug,'title':title,'src':p,'blocks':blocks})
order=['chemist','sop','medicine','brute','patches','reactions','doctor','botanicals','cryo','medical']
pages.sort(key=lambda x: order.index(x['slug']))
json.dump(pages, open('guidebook.json','w'))
for pg in pages: print(pg['slug'], len(pg['blocks']), [b['t'] for b in pg['blocks']][:12])
