#!/usr/bin/env python3
"""Render the original Train Trouble cartoon cutscenes as offline MP4 assets."""
import argparse
import math
from pathlib import Path
import random
import struct
import subprocess
import tempfile
import wave
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'train-trouble/media'
W, H, FPS, DURATION, SCALE = 960, 540, 30, 4.5, 2
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT = ImageFont.truetype(FONT_PATH, 38*SCALE)
SMALL = ImageFont.truetype(FONT_PATH, 23*SCALE)
INK = '#173046'

def ease(x):
    x = max(0, min(1, x))
    return x*x*(3-2*x)

class Art:
    def __init__(self):
        self.image = Image.new('RGB', (W*SCALE, H*SCALE), '#92d9ec')
        self.d = ImageDraw.Draw(self.image)
    def box(self, xy, fill, radius=0, outline=None, width=1):
        xy = tuple(round(v*SCALE) for v in xy)
        if radius:
            self.d.rounded_rectangle(xy, radius=round(radius*SCALE), fill=fill,
                                     outline=outline, width=round(width*SCALE))
        else:
            self.d.rectangle(xy, fill=fill, outline=outline, width=round(width*SCALE))
    def ellipse(self, xy, fill, outline=None, width=1):
        self.d.ellipse(tuple(round(v*SCALE) for v in xy), fill=fill, outline=outline, width=round(width*SCALE))
    def line(self, pts, fill, width=2):
        self.d.line([(round(x*SCALE),round(y*SCALE)) for x,y in pts], fill=fill,
                    width=round(width*SCALE), joint='curve')
    def poly(self, pts, fill, outline=None):
        self.d.polygon([(round(x*SCALE),round(y*SCALE)) for x,y in pts], fill=fill, outline=outline)
    def text(self, xy, text, fill='white', font=FONT, anchor='mm'):
        self.d.text(tuple(round(v*SCALE) for v in xy), text, fill=fill, font=font,
                    anchor=anchor, stroke_width=0 if fill == INK else 2*SCALE, stroke_fill=INK)

def wheel(a, x, y, r, spin, yellow=False):
    a.ellipse((x-r,y-r,x+r,y+r), '#f2b843' if yellow else '#26415a', INK, 3)
    for j in range(6):
        angle=spin+j*math.pi/3
        a.line([(x,y),(x+math.cos(angle)*r*.8,y+math.sin(angle)*r*.8)], '#c0dbe9', 3)
    a.ellipse((x-4,y-4,x+4,y+4), '#fff3bb', INK, 1)

def engine(a,x,y,color,dir=1,squash=0,t=0,wreck=False):
    # A body made from articulated panels becomes a visibly crumpled accordion.
    sign=dir
    points=[]
    for i in range(9):
        px=x+sign*(i-4)*19*(1-squash*.5)
        py=y-70+(15 if i%2 else -12)*squash
        points.append((px,py))
    points += [(px,py+62) for px,py in reversed(points)]
    a.poly(points, color)
    a.line(points+[points[0]], INK, 4)
    if squash:
        for px,py in points[:9]:
            a.line([(px,py),(px,py+62)], '#fff1c4', 3)
    cabx=x-sign*63
    a.box((cabx-28,y-119,cabx+28,y-46),color,10,INK,4)
    a.box((cabx-19,y-109,cabx+19,y-82),'#c5f0ff',7,INK,3)
    roof_shift=sign*squash*13
    a.box((cabx-35+roof_shift,y-130,cabx+35+roof_shift,y-115),INK,5)
    stackx=x+sign*43
    a.poly([(stackx-13,y-71),(stackx+12,y-71),(stackx+10+sign*squash*23,y-122),
            (stackx-12+sign*squash*23,y-122)], '#2d435c', INK)
    a.box((stackx-18+sign*squash*23,y-130,stackx+18+sign*squash*23,y-117),INK,4)
    a.line([(x-sign*97,y-17),(x+sign*92,y-17)],INK,10)
    for k in [-55,-2,51]:
        if not wreck or k==-55:
            wheel(a,x+k,y-10,22,t*9)
    # Face is a little surprised engine face, not a person in danger.
    face=x+sign*76*(1-squash*.5)
    a.ellipse((face-16,y-69,face+16,y-36),'#fff3bb',INK,3)
    a.ellipse((face-5,y-61,face+1,y-53),INK)
    a.ellipse((face+5,y-61,face+11,y-53),INK)
    a.ellipse((face-3,y-48,face+5,y-39),INK)

def duck(a,x,y,r,angle=0):
    a.ellipse((x-r,y-r*.4,x+r,y+r*.55),'#ffe13b',INK,2)
    a.ellipse((x-r*.4,y-r,x+r*.7,y+r*.1),'#ffe13b',INK,2)
    a.poly([(x+r*.7,y-r*.7),(x+r*1.4,y-r*.35),(x+r*.7,y-r*.05)],'#ff8d36',INK)
    a.ellipse((x+r*.25,y-r*.7,x+r*.4,y-r*.55),INK)

def conductor(a,x,y,t):
    bob=math.sin(t*6)*2
    y+=bob
    a.line([(x-8,y+24),(x-18,y+58)],INK,10)
    a.line([(x+8,y+24),(x+22,y+58)],INK,10)
    a.ellipse((x-31,y+51,x-10,y+64),INK)
    a.ellipse((x+12,y+51,x+36,y+64),INK)
    a.box((x-22,y-10,x+22,y+37),'#347fbd',10,INK,3)
    a.ellipse((x-23,y-54,x+23,y-8),'#f7c99f',INK,3)
    a.box((x-28,y-66,x+24,y-51),'#266597',6,INK,3)
    a.box((x-32,y-55,x+35,y-47),'#266597',4,INK,3)
    a.ellipse((x-10,y-39,x-5,y-31),INK)
    a.ellipse((x+7,y-39,x+12,y-31),INK)
    # Soot smudges, smile, one thumb up and a tyre around the middle.
    a.ellipse((x-19,y-28,x-9,y-21),'#696861')
    a.ellipse((x+13,y-27,x+20,y-20),'#696861')
    a.line([(x-6,y-20),(x,y-16),(x+7,y-20)],INK,2)
    a.line([(x-20,y),(x-38,y+20)],'#f7c99f',9)
    a.line([(x+18,y),(x+40,y-16)],'#f7c99f',9)
    a.ellipse((x+32,y-30,x+48,y-11),'#f7c99f',INK,2)
    a.line([(x+39,y-25),(x+38,y-38)],'#f7c99f',7)
    a.ellipse((x-38,y+2,x+38,y+47),'#263646',INK,3)
    a.ellipse((x-22,y+12,x+22,y+34),'#75b6d7',INK,2)

def render(kind,t):
    a=Art()
    a.ellipse((690,45,780,135),'#ffe8a0')
    a.ellipse((-150,150,460,530),'#8dcc8a')
    a.ellipse((350,165,1110,560),'#69b487')
    a.box((0,340,W,H),'#b9d68c')
    a.box((0,404,W,447),'#776957')
    for x in range(-10,W,37):
        a.poly([(x,398),(x+13,398),(x+27,459),(x+14,459)],'#786050')
    a.line([(0,407),(W,407)],'#d4d8dc',6)
    a.line([(0,443),(W,443)],'#d4d8dc',6)
    a.line([(0,413),(W,413)],INK,2)
    a.line([(0,449),(W,449)],INK,2)
    impact=1.05
    q=max(0,t-impact)
    squash=ease(q/.48)
    shake=math.sin(q*75)*max(0,1-q/.7)*8 if q else 0
    center=480+shake
    if kind=='head-on':
        x1=175+(center-88-175)*ease(t/impact)
        x2=785-(785-center-88)*ease(t/impact)
        engine(a,x1,410,'#e75c55',1,squash,t,bool(q))
        engine(a,x2,410,'#36b9c5',-1,squash,t,bool(q))
    elif kind=='rear-end':
        x1=100+(center-60-100)*ease(t/impact)
        x2=570+min(t,impact)*22
        engine(a,x1,410,'#36b9c5',1,squash,t,bool(q))
        engine(a,x2,410,'#f5b53d',1,squash*.85,t,bool(q))
    else:
        x1=120+(center-92-120)*ease(t/impact)
        engine(a,x1,410,'#9471c8',1,squash,t,bool(q))
        a.poly([(490,331),(653,320+q*2),(638,393),(505,393)],'#e5ad60',INK)
        a.line([(497,345),(644,335)],'#93613c',5)
        for x in [527,596]:
            if not q:wheel(a,x,403,23,t*8)
        if not q:
            for j in range(5):duck(a,505+j*28,319-abs(j-2)*6,15)
    # Steam starts gentle, then turns into a wide, funny smoke puff at impact.
    for i in range(7):
        st=max(0,t-.15*i)
        x=(170+i*20+t*55)%420
        if not q:
            a.ellipse((x,192-i*12,x+25+i*3,217-i*12),'#edf4e8')
    if q>0:
        for i in range(12):
            angle=i*2.4
            r=32+q*12
            px=center+math.cos(angle)*(35+q*22)
            py=310-math.sin(angle)*(25+q*12)
            if q<1.7:
                a.ellipse((px-r,py-r,px+r,py+r),'#f9edcb')
        # Body fragments are mechanical panels and bolts, never people.
        for i in range(11):
            velocity=(i-5)*58
            xx=center+velocity*q
            yy=310-(90+14*(i%4))*q+110*q*q
            if yy<470:
                if kind=='cargo':duck(a,xx,yy,14+(i%3)*3)
                else:
                    a.box((xx-8,yy-5,xx+8,yy+5),['#e75c55','#36b9c5','#ffdf6b'][i%3],4,INK,2)
        for i in range(4):
            xx=center+(i-1.5)*97*q
            yy=340-(150+32*(i%2))*q+125*q*q
            yy=min(462,yy)
            wheel(a,xx,yy,19,q*(i+5),i==3)
        if q<.78:
            star=[]
            radius=65+22*math.sin(q*5)
            for i in range(24):
                rr=radius if i%2==0 else radius*.52
                star.append((center+math.cos(i*math.pi/12)*rr,287+math.sin(i*math.pi/12)*rr))
            a.poly(star,'#ffe45c',INK)
            a.text((center,287),'CLANG!',font=SMALL)
    if t>2.0:
        fall=max(0,2.7-t)
        conductor(a,730,385-fall*110,t)
        if t>2.45:
            a.box((621,120,925,196),'#fff5d9',18,INK,4)
            a.poly([(727,196),(744,217),(761,196)],'#fff5d9',INK)
            a.text((773,156),'I’m fine!',INK,SMALL)
    a.box((22,20,938,84),'#142d43',18)
    captions={'head-on':"That’ll buff out.",'rear-end':'A little too close.','cargo':'Duck delivery!'}
    a.text((480,52),captions[kind],font=FONT)
    if t>3.05:
        a.box((155,466,805,522),'#142d43',17)
        a.text((480,493),'Everyone is safe. The trains need a minute.',font=SMALL)
    return a.image.resize((W,H),Image.Resampling.LANCZOS)

def sound(path,kind):
    rate=44100
    randomizer=random.Random(420+len(kind))
    samples=[]
    for i in range(round(rate*DURATION)):
        t=i/rate
        v=0
        if t<.85:
            v += .1*math.sin(2*math.pi*220*t)*min(1,t*8)*max(0,1-t/.85)
        q=t-1.05
        if 0<=q<.65:
            v += .15*(randomizer.random()*2-1)*math.exp(-q*9)
            v += .12*math.sin(2*math.pi*(153-70*q)*q)*math.exp(-q*6)
        for j in range(4):
            p=t-(1.3+j*.19)
            if 0<=p<.24:
                v += .11*math.sin(2*math.pi*(590-j*85)*p)*math.exp(-p*15)
        p=t-2.6
        if 0<=p<.5:
            v += .07*math.sin(2*math.pi*(440 if p<.23 else 660)*p)*math.sin(math.pi*p/.5)
        samples.append(struct.pack('<h',round(max(-.8,min(.8,v))*32767)))
    with wave.open(str(path),'wb') as out:
        out.setnchannels(1);out.setsampwidth(2);out.setframerate(rate);out.writeframes(b''.join(samples))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind',choices=['head-on','rear-end','cargo'])
    args=parser.parse_args()
    kinds=[args.kind] if args.kind else ['head-on','rear-end','cargo']
    OUT.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='train-crash-audio-') as temp:
        for kind in kinds:
            wav=Path(temp)/f'{kind}.wav';sound(wav,kind)
            target=OUT/f'crash-{kind}.mp4'
            command=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-vcodec','rawvideo',
                     '-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-', '-i',str(wav),
                     '-c:v','libx264','-profile:v','baseline','-level:v','3.1','-preset','fast','-crf','21',
                     '-pix_fmt','yuv420p','-movflags','+faststart','-c:a','aac','-b:a','96k','-shortest',str(target)]
            process=subprocess.Popen(command,stdin=subprocess.PIPE)
            try:
                for frame in range(round(FPS*DURATION)):
                    process.stdin.write(render(kind,frame/FPS).tobytes())
            finally:
                process.stdin.close()
            if process.wait()!=0:raise SystemExit('FFmpeg failed')
            render(kind,2.9).save(OUT/f'crash-{kind}.jpg',quality=92)
            fallback=target.with_suffix('.webm')
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(target),
                            '-map','0:v:0','-map','0:a:0','-c:v','libvpx-vp9','-crf','36','-b:v','0',
                            '-deadline','good','-cpu-used','2','-row-mt','1','-threads','2',
                            '-c:a','libopus','-b:a','48k',str(fallback)],check=True)
            print(f'Rendered {target.relative_to(ROOT)} ({target.stat().st_size:,} bytes) and '
                  f'{fallback.name} ({fallback.stat().st_size:,} bytes)',flush=True)

if __name__=='__main__':main()
