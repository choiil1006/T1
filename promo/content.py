TEAM="티원"; TEAM_EN="TEAM T1"
MEMBERS=["최원준","우성민"]
OPS=["화면의 화살표가 판정선에 닿는 순간 해당 발판을 밟는다",
     "발판 아래 로드셀이 체중 변화를 감지해 게임에 입력된다",
     "판정과 콤보에 따라 발판 조명과 점수 램프가 켜진다"]
PRIN=["발판마다 로드셀 4개와 HX711 모듈로 밟는 압력을 측정",
      "Raspberry Pi Pico가 눌림을 판정해 USB 키보드 신호로 게임에 입력",
      "Mitsubishi FX3U PLC로 발판 LED와 점수 램프를 제어",
      "알루미늄 프로파일 프레임과 PC 판으로 사람의 체중을 지지"]
REV=[("최원준","처음 시도해보는 로드셀 제어를 이용한 프로젝트를 제작하면서 사람의 체중을 어떻게 안전하게 받을 수 있을지, 조그만 기판들을 어떻게 연결하여 입력과 출력을 전달할 수 있을지와 같은 난이도 있는 과제와 부딪혀 보면서 3학년의 마지막을 제대로 불태운 것 같아서 만족스럽습니다."),
     ("우성민","게임 화면과 발판, PLC 조명이 하나의 신호로 이어지도록 맞춰 가는 과정이 생각보다 훨씬 까다로웠습니다. 값이 튈 때마다 선을 다시 잇고 숫자를 다시 읽던 시행착오 끝에, 처음으로 발판을 밟자 화면에 입력이 들어오고 불이 켜졌을 때의 짜릿함은 잊지 못할 것 같습니다. 친구와 끝까지 완성해 낸 이 작품이 고등학교 3년의 가장 큰 자랑으로 남을 것 같습니다.")]

def pad_svg(size, colors, stroke=6, glow=True, fill_alpha=0.18, tube=False, gid="g"):
    """Pump-style 5 pads (corners + center), top view."""
    s=size; c=s/3; g=c*0.08
    # pad order: 좌상, 우상, 중앙, 좌하, 우하
    pads=[(0,0,'ul'),(2,0,'ur'),(1,1,'c'),(0,2,'dl'),(2,2,'dr')]
    out=[f'<svg viewBox="-30 -30 {s+60} {s+60}" width="{s}" height="{s}" style="overflow:visible" xmlns="http://www.w3.org/2000/svg">',
         f'<defs><filter id="{gid}" filterUnits="userSpaceOnUse" x="-40" y="-40" width="{s+80}" height="{s+80}"><feGaussianBlur stdDeviation="{stroke*1.4}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>']
    flt=f' filter="url(#{gid})"' if glow else ''
    for gx,gy,k in pads:
        col=colors[k]; x=gx*c+g; y=gy*c+g; w=c-2*g
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{w}" rx="{w*0.12}" fill="{col}" fill-opacity="{fill_alpha}" stroke="{col}" stroke-width="{stroke}"{flt}/>')
        cx=x+w/2; cy=y+w/2; r=w*0.30
        if k=='c':
            out.append(f'<rect x="{cx-r*0.8}" y="{cy-r*0.8}" width="{r*1.6}" height="{r*1.6}" rx="{r*0.2}" fill="none" stroke="{col}" stroke-width="{stroke}"{flt}/>')
        else:
            # arrow pointing to the corner direction
            ang={'ul':225,'ur':315,'dl':135,'dr':45}[k]
            pts=[(r,0),(-r*0.2,-r*0.75),(-r*0.2,-r*0.3),(-r*0.95,-r*0.3),(-r*0.95,r*0.3),(-r*0.2,r*0.3),(-r*0.2,r*0.75)]
            import math
            a=math.radians(ang); P=" ".join(f"{cx+px*math.cos(a)-py*math.sin(a):.1f},{cy+px*math.sin(a)+py*math.cos(a):.1f}" for px,py in pts)
            out.append(f'<polygon points="{P}" fill="{col if not tube else "none"}" fill-opacity="{0.9 if not tube else 0}" stroke="{col}" stroke-width="{stroke*0.7}" stroke-linejoin="round"{flt}/>')
    out.append('</svg>'); return "".join(out)
