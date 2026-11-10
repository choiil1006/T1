from content import *
W,H=1240,1754
BASE="""<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:%dpx;height:%dpx;overflow:hidden}
body{font-family:'Gothic A1',sans-serif;word-break:keep-all}
%s</style></head><body>%s</body></html>"""
def li(items,cls="li"): return "".join(f'<div class="{cls}"><span class="dot"></span><span>{t}</span></div>' for t in items)

# ---------------- A: Synthwave grid ----------------
A_CSS="""
body{background:linear-gradient(180deg,#0b0420 0%,#1d0b45 38%,#4a0f6b 62%,#120424 100%);color:#f4ecff;position:relative}
.stars{position:absolute;inset:0;background-image:radial-gradient(2px 2px at 10% 8%,#fff8,transparent),radial-gradient(2px 2px at 80% 12%,#fff9,transparent),radial-gradient(1.5px 1.5px at 60% 4%,#fff7,transparent),radial-gradient(1.5px 1.5px at 30% 18%,#fff6,transparent),radial-gradient(2px 2px at 92% 30%,#fff6,transparent),radial-gradient(1.5px 1.5px at 5% 32%,#fff6,transparent)}
.sun{position:absolute;left:80px;top:420px;width:360px;height:360px;margin-left:0;border-radius:50%;
 background:linear-gradient(180deg,#ffe36e 0%,#ff7ac6 55%,#b02cff 100%);opacity:.9;
 -webkit-mask:linear-gradient(180deg,#000 0 52%,transparent 52% 55%,#000 55% 64%,transparent 64% 68%,#000 68% 76%,transparent 76% 81%,#000 81% 88%,transparent 88% 94%,#000 94%);
 box-shadow:0 0 120px #ff4fd8}
.floor{position:absolute;left:-30%;right:-30%;bottom:-120px;height:520px;transform:perspective(500px) rotateX(62deg);transform-origin:50% 100%;
 background-image:linear-gradient(#ff3fd8 2px,transparent 2px),linear-gradient(90deg,#ff3fd8 2px,transparent 2px);background-size:80px 80px;opacity:.45;
 -webkit-mask:linear-gradient(180deg,transparent,#000 40%)}
.wrap{position:absolute;inset:0;padding:64px 70px}
.top{display:flex;justify-content:space-between;align-items:center;font-family:Orbitron;letter-spacing:6px;font-size:22px;color:#7ff9ff;text-shadow:0 0 12px #2ef0ff}
.title{margin:28px auto 0;height:180px;border:4px dashed #ff7ad9;border-radius:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;
 color:#ffb8ee;font-family:'Black Han Sans';font-size:64px;text-shadow:0 0 18px #ff3fd8;box-shadow:0 0 30px #ff3fd855 inset;background:#0b0420cc}
.title small{font-family:'Gothic A1';font-size:22px;color:#ffd6f4;margin-top:8px;text-shadow:none;letter-spacing:2px}
.team{margin-top:26px;display:flex;align-items:center;gap:22px;justify-content:center}
.team .name{font-family:'Black Han Sans';font-size:46px;color:#fff;text-shadow:0 0 14px #2ef0ff,0 0 30px #2ef0ff}
.team .bar{width:3px;height:44px;background:#7ff9ff;box-shadow:0 0 10px #2ef0ff}
.team .mem{font-size:32px;font-weight:700;color:#e7f9ff}
.mid{display:flex;gap:34px;margin-top:28px;align-items:stretch;position:relative}
.padbox{width:380px;height:380px;display:flex;align-items:center;justify-content:center;flex:none}
.photo{flex:1;border:3px dashed #7ff9ff;border-radius:22px;position:relative;z-index:1;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#bff8ff;font-size:28px;font-weight:700;background:#0b0a2a88;box-shadow:0 0 26px #2ef0ff55}
.photo span{font-size:18px;font-weight:400;margin-top:8px;opacity:.8}
.card{margin-top:22px;background:#140a33dd;border:2px solid #ff5fd8;border-radius:22px;padding:18px 30px;box-shadow:0 0 22px #ff3fd877,0 0 2px #fff inset}
.card.c{border-color:#2ef0ff;box-shadow:0 0 22px #2ef0ff77}
.h{display:flex;align-items:baseline;gap:16px;margin-bottom:12px}
.h b{font-family:'Do Hyeon';font-weight:400;font-size:40px;color:#fff;text-shadow:0 0 10px #ff3fd8aa}
.card.c .h b{text-shadow:0 0 10px #2ef0ffaa}
.h i{font-family:Orbitron;font-style:normal;font-size:17px;letter-spacing:3px;color:#ff9be6}
.card.c .h i{color:#8ff6ff}
.li{display:flex;gap:14px;align-items:flex-start;font-size:22px;line-height:1.45;margin:3px 0}
.dot{flex:none;width:12px;height:12px;margin-top:12px;border-radius:50%;background:#ff7ad9;box-shadow:0 0 10px #ff3fd8}
.card.c .dot{background:#7ff9ff;box-shadow:0 0 10px #2ef0ff}
.rev{display:flex;gap:22px}
.rv{flex:1;font-size:17px;line-height:1.55;color:#f1e9ff}
.rv b{display:block;font-size:22px;color:#ffe36e;margin-bottom:6px;text-shadow:0 0 10px #ffb800}
"""
def variantA():
    pad=pad_svg(360,{'ul':'#ff4f6d','ur':'#ff4f6d','c':'#ffe36e','dl':'#2ef0ff','dr':'#2ef0ff'},stroke=6,fill_alpha=0.15)
    b=f"""<div class="stars"></div><div class="sun"></div><div class="floor"></div><div class="wrap">
<div class="top"><span>{TEAM_EN}</span><span>RHYTHM · LOAD CELL · PLC</span></div>
<div class="title">작품 제목<small>TITLE AREA</small></div>
<div class="team"><span class="name">조 이름 {TEAM}</span><span class="bar"></span><span class="mem">{' · '.join(MEMBERS)}</span></div>
<div class="mid"><div class="padbox">{pad}</div><div class="photo">사진 자리<span>완성품 또는 제작 과정 사진</span></div></div>
<div class="card"><div class="h"><b>동작설명</b><i>OPERATION</i></div>{li(OPS)}</div>
<div class="card c"><div class="h"><b>작동원리</b><i>PRINCIPLE</i></div>{li(PRIN)}</div>
<div class="card"><div class="h"><b>제작후기</b><i>REVIEW</i></div><div class="rev">{''.join(f'<div class="rv"><b>{n}</b>{t}</div>' for n,t in REV)}</div></div>
</div>"""
    return BASE%(W,H,A_CSS,b)

# ---------------- B: Arcade HUD ----------------
B_CSS="""
body{background:#05060a;color:#e9ffe0;position:relative}
body:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,#ffffff06 0 2px,transparent 2px 5px);pointer-events:none}
.lanes{position:absolute;right:52px;top:0;bottom:0;width:150px;display:flex;gap:6px;opacity:.55}
.lane{flex:1;background:linear-gradient(180deg,transparent,#ffffff0c);border-left:1px solid #ffffff14;position:relative}
.note{position:absolute;left:3px;right:3px;height:22px;border-radius:5px}
.judge{position:absolute;right:40px;top:1400px;width:176px;height:6px;background:#b6ff3b;box-shadow:0 0 18px #b6ff3b}
.wrap{position:absolute;left:64px;top:60px;width:900px}
.hud{display:flex;justify-content:space-between;font-family:Orbitron;font-weight:700;font-size:20px;letter-spacing:4px;color:#b6ff3b;text-shadow:0 0 10px #8cff00}
.hud em{font-style:normal;color:#ff4fa8;text-shadow:0 0 10px #ff2a8a}
.title{position:relative;margin-top:26px;height:200px;border:3px solid #b6ff3b;display:flex;flex-direction:column;align-items:center;justify-content:center;
 font-family:'Black Han Sans';font-size:62px;color:#d8ff9a;text-shadow:0 0 16px #8cff00;background:#b6ff3b0d}
.title small{font-family:Orbitron;font-size:18px;letter-spacing:6px;margin-top:6px;color:#b6ff3baa;text-shadow:none}
.corner{position:absolute;width:26px;height:26px;border:5px solid #ff4fa8;box-shadow:0 0 10px #ff2a8a}
.tl{left:-12px;top:-12px;border-right:0;border-bottom:0}.tr{right:-12px;top:-12px;border-left:0;border-bottom:0}
.bl{left:-12px;bottom:-12px;border-right:0;border-top:0}.br{right:-12px;bottom:-12px;border-left:0;border-top:0}
.players{display:flex;gap:20px;margin-top:30px}
.pl{flex:1;border:2px solid #2ee6ff;padding:14px 20px;display:flex;align-items:center;gap:18px;box-shadow:0 0 16px #2ee6ff55;background:#2ee6ff0d}
.pl .tag{font-family:Orbitron;font-weight:900;font-size:30px;color:#05060a;background:#2ee6ff;padding:4px 12px;box-shadow:0 0 14px #2ee6ff}
.pl .nm{font-family:'Black Han Sans';font-size:40px;color:#fff;text-shadow:0 0 10px #2ee6ff}
.pl.team{border-color:#ff4fa8;box-shadow:0 0 16px #ff2a8a55;background:#ff4fa80d}
.pl.team .tag{background:#ff4fa8;box-shadow:0 0 14px #ff2a8a}
.pl.team .nm{text-shadow:0 0 10px #ff2a8a}
.mid{display:flex;gap:24px;margin-top:28px}
.padbox{width:330px;height:330px;flex:none;display:flex;align-items:center;justify-content:center;border:2px solid #ffffff22;background:#ffffff05}
.photo{flex:1;border:3px dashed #ffd23f;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#ffe680;font-size:28px;font-weight:700;background:#ffd23f0a}
.photo span{font-size:17px;font-weight:400;margin-top:8px;opacity:.85}
.combo{margin-top:22px;display:flex;align-items:baseline;gap:18px;font-family:Orbitron;font-weight:900}
.combo .p{font-size:54px;color:#fff;letter-spacing:4px;text-shadow:0 0 8px #ffd23f,0 0 24px #ff9f1a}
.combo .n{font-size:30px;color:#ffd23f;letter-spacing:3px}
.sec{margin-top:20px;border-left:6px solid #b6ff3b;padding:4px 0 4px 22px}
.sec.p{border-color:#2ee6ff}.sec.r{border-color:#ff4fa8}
.h{display:flex;align-items:baseline;gap:14px;margin-bottom:8px}
.h b{font-family:'Do Hyeon';font-weight:400;font-size:38px;color:#b6ff3b;text-shadow:0 0 8px #8cff0088}
.sec.p .h b{color:#2ee6ff;text-shadow:0 0 8px #00c8ff88}.sec.r .h b{color:#ff4fa8;text-shadow:0 0 8px #ff2a8a88}
.h i{font-family:Orbitron;font-style:normal;font-size:15px;letter-spacing:4px;color:#ffffff88}
.li{display:flex;gap:12px;font-size:22px;line-height:1.5;margin:3px 0}
.dot{flex:none;width:12px;height:12px;margin-top:11px;background:#b6ff3b;transform:rotate(45deg);box-shadow:0 0 8px #8cff00}
.sec.p .dot{background:#2ee6ff;box-shadow:0 0 8px #00c8ff}
.rev{display:flex;gap:22px}
.rv{flex:1;font-size:17.5px;line-height:1.6;color:#f3e9f0;background:#ff4fa80c;border:1px solid #ff4fa855;padding:14px 16px}
.rv b{display:block;font-size:21px;color:#fff;margin-bottom:6px}
"""
def variantB():
    import random; random.seed(7)
    cols=['#ff4f6d','#2ef0ff','#ffe36e','#2ef0ff','#ff4f6d']
    lanes=""
    for i in range(5):
        notes="".join(f'<div class="note" style="top:{y}px;background:{cols[i]};box-shadow:0 0 14px {cols[i]}"></div>' for y in sorted(random.sample(range(40,1340,60),6)))
        lanes+=f'<div class="lane">{notes}</div>'
    pad=pad_svg(300,{'ul':'#ff4f6d','ur':'#ff4f6d','c':'#ffe36e','dl':'#2ef0ff','dr':'#2ef0ff'},stroke=5,fill_alpha=0.12,gid="gb")
    b=f"""<div class="lanes">{lanes}</div><div class="judge"></div><div class="wrap">
<div class="hud"><span>STAGE 01</span><span><em>●</em> INSERT FOOT</span><span>SCORE 0000000</span></div>
<div class="title"><span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>작품 제목<small>TITLE AREA</small></div>
<div class="players"><div class="pl team"><span class="tag">TEAM</span><span class="nm">{TEAM}</span></div>
<div class="pl"><span class="tag">1P</span><span class="nm">{MEMBERS[0]}</span></div><div class="pl"><span class="tag">2P</span><span class="nm">{MEMBERS[1]}</span></div></div>
<div class="mid"><div class="padbox">{pad}</div><div class="photo">사진 자리<span>완성품 또는 제작 과정 사진</span></div></div>
<div class="combo"><span class="p">PERFECT</span><span class="n">× 128 COMBO</span></div>
<div class="sec"><div class="h"><b>동작설명</b><i>HOW TO PLAY</i></div>{li(OPS)}</div>
<div class="sec p"><div class="h"><b>작동원리</b><i>SYSTEM</i></div>{li(PRIN)}</div>
<div class="sec r"><div class="h"><b>제작후기</b><i>STAFF COMMENT</i></div><div class="rev">{''.join(f'<div class="rv"><b>{n}</b>{t}</div>' for n,t in REV)}</div></div>
</div>"""
    return BASE%(W,H,B_CSS,b)

# ---------------- C: Neon sign on wall ----------------
C_CSS="""
body{color:#fff3ea;position:relative;
 background:radial-gradient(ellipse at 50% 30%,#3a1530 0%,transparent 60%),radial-gradient(ellipse at 50% 85%,#0f2b3a 0%,transparent 55%),
 repeating-linear-gradient(0deg,#00000055 0 3px,transparent 3px 70px),
 repeating-linear-gradient(90deg,#00000044 0 3px,transparent 3px 140px),#1a1418}
.wrap{position:absolute;inset:0;padding:70px 76px}
.title{height:230px;border-radius:120px;border:6px solid #ff5aa0;display:flex;flex-direction:column;align-items:center;justify-content:center;
 box-shadow:0 0 14px #ff5aa0,0 0 44px #ff2d7a,inset 0 0 14px #ff5aa0,inset 0 0 40px #ff2d7a88;font-family:Jua;font-size:66px;color:#ffe3ef;
 text-shadow:0 0 8px #ff7ab4,0 0 24px #ff2d7a}
.title small{font-family:'Gothic A1';font-size:22px;letter-spacing:3px;margin-top:6px;text-shadow:0 0 8px #ff2d7a;color:#ffc6dc}
.team{margin-top:34px;text-align:center}
.team .t{font-family:Monoton;font-size:62px;color:#fff6c7;letter-spacing:6px;text-shadow:0 0 6px #ffcf3f,0 0 22px #ff9b00,0 0 44px #ff9b00}
.team .k{font-family:Jua;font-size:40px;color:#fff6c7;text-shadow:0 0 10px #ff9b00;margin-left:10px}
.team .m{margin-top:6px;font-family:Jua;font-size:34px;color:#c9fbff;text-shadow:0 0 8px #3ff0ff,0 0 22px #00b8ff}
.mid{display:flex;gap:30px;margin-top:30px}
.padbox{width:400px;height:400px;flex:none;display:flex;align-items:center;justify-content:center}
.photo{flex:1;border-radius:26px;border:4px dashed #57f0ff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Jua;font-size:32px;color:#c9fbff;
 text-shadow:0 0 10px #00b8ff;box-shadow:0 0 22px #00b8ff55,inset 0 0 22px #00b8ff33}
.photo span{font-family:'Gothic A1';font-size:18px;margin-top:8px;opacity:.85}
.row{display:flex;gap:26px;margin-top:30px}
.box{flex:1;border-radius:26px;border:4px solid #7dff9a;padding:22px 26px;box-shadow:0 0 12px #7dff9a,0 0 34px #18d64688,inset 0 0 18px #18d64644;background:#0a140c66}
.box.o{border-color:#ffb347;box-shadow:0 0 12px #ffb347,0 0 34px #ff8a0088,inset 0 0 18px #ff8a0044;background:#140c0466}
.h{font-family:Jua;font-size:38px;margin-bottom:10px;color:#eaffef;text-shadow:0 0 8px #7dff9a,0 0 22px #18d646}
.box.o .h{color:#fff1df;text-shadow:0 0 8px #ffb347,0 0 22px #ff8a00}
.h i{font-style:normal;font-family:'Gothic A1';font-size:15px;letter-spacing:3px;margin-left:10px;opacity:.75}
.li{display:flex;gap:12px;font-size:20.5px;line-height:1.5;margin:6px 0}
.dot{flex:none;width:11px;height:11px;margin-top:11px;border-radius:50%;background:#7dff9a;box-shadow:0 0 10px #18d646}
.box.o .dot{background:#ffb347;box-shadow:0 0 10px #ff8a00}
.revbox{margin-top:30px;border-radius:26px;border:4px solid #b78bff;padding:22px 28px;box-shadow:0 0 12px #b78bff,0 0 34px #7a3dff88,inset 0 0 18px #7a3dff44;background:#0e0a1866}
.revbox .h{color:#f1e9ff;text-shadow:0 0 8px #b78bff,0 0 22px #7a3dff}
.rev{display:flex;gap:26px}
.rv{flex:1;font-size:18px;line-height:1.6}
.rv b{display:block;font-family:Jua;font-size:26px;font-weight:400;color:#e7dbff;text-shadow:0 0 10px #7a3dff;margin-bottom:4px}
"""
def variantC():
    pad=pad_svg(390,{'ul':'#ff5aa0','ur':'#ff5aa0','c':'#ffcf3f','dl':'#57f0ff','dr':'#57f0ff'},stroke=7,fill_alpha=0.0,tube=True,gid="gc")
    b=f"""<div class="wrap">
<div class="title">작품 제목<small>TITLE AREA</small></div>
<div class="team"><span class="t">T1</span><span class="k">티원</span><div class="m">{' ✦ '.join(MEMBERS)}</div></div>
<div class="mid"><div class="padbox">{pad}</div><div class="photo">사진 자리<span>완성품 또는 제작 과정 사진</span></div></div>
<div class="row"><div class="box"><div class="h">동작설명<i>OPERATION</i></div>{li(OPS)}</div>
<div class="box o"><div class="h">작동원리<i>PRINCIPLE</i></div>{li(PRIN)}</div></div>
<div class="revbox"><div class="h">제작후기<i>REVIEW</i></div><div class="rev">{''.join(f'<div class="rv"><b>{n}</b>{t}</div>' for n,t in REV)}</div></div>
</div>"""
    return BASE%(W,H,C_CSS,b)

for k,f in (("A",variantA),("B",variantB),("C",variantC)):
    open(f"panel-{k}.html","w").write(f())
