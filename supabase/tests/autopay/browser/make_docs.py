from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import os
OUT=os.environ.get('AP_DOCS','docs')
P=os.environ.get('AP_PREFIX','APB')
os.makedirs(OUT, exist_ok=True)
import datetime
SH=int(os.environ.get('AP_SHIFT','0'))
def D(m,d):
    x=datetime.date(2026,m,d)+datetime.timedelta(days=SH)
    return x.strftime('%m/%d/%Y')
def doc(name, title, lines, key):
    c=canvas.Canvas(os.path.join(OUT,name), pagesize=letter, pageCompression=0)
    c.setFont('Helvetica-Bold',18); c.drawString(54,740,title)
    c.setFont('Helvetica',11); y=710
    for l in lines:
        c.drawString(54,y,l); y-=18
    c.setFont('Helvetica',6); c.drawString(54,40,f'SYNTHETIC TEST DOCUMENT - not a real load. KEY:{key}')
    c.save()
CAR='Carrier: AP Synthetic Freight LLC   MC# 771234'
doc(f'ratecon-{P}-1001.pdf','RATE CONFIRMATION',[ 'Blue Ridge Logistics  MC# 500100',f'Load # {P}-1001',CAR,'Driver: Marcus Reed  Truck 112',
  f'Pickup: Acme Foods, Dallas, TX  {D(10,13)}',f'Delivery: HEB DC, Houston, TX  {D(10,14)}','Miles: 240','Line Haul: $1,850.00','Fuel Surcharge: $0.00','Total Carrier Pay: $1,850.00'],f'rc-{P.lower()}-1001')
doc(f'pod-{P}-1001.pdf','PROOF OF DELIVERY',[f'Load # {P}-1001   BOL # BOL-{P}-1001',CAR,f'Shipper: Acme Foods, Dallas, TX  {D(10,13)}',f'Consignee: HEB DC, Houston, TX  {D(10,14)}','Received in good order - signed: J. Ortiz'],f'pod-{P.lower()}-1001')
doc(f'fuel-{P}-1001.pdf','PILOT TRAVEL CENTER #452',[f'Date {D(10,14)}  Unit 112',f'Load {P}-1001','Diesel 101.20 gal @ 4.073','TOTAL $412.18','Receipt # 88231'],f'fuel-{P.lower()}-1001')
doc(f'pod-{P}-2002.pdf','PROOF OF DELIVERY',[f'Load # {P}-2002   BOL # BOL-{P}-2002',CAR,f'Shipper: Tulsa Mill, Tulsa, OK  {D(10,14)}',f'Consignee: Front Range DC, Denver, CO  {D(10,15)}','Received - signed: K. Lee'],f'pod-{P.lower()}-2002')
doc(f'fuel-{P}-2002.pdf','LOVES TRAVEL STOP #611',[f'Date {D(10,14)}  Unit 207',f'Load {P}-2002','Diesel 98.10 gal','TOTAL $398.40','Receipt # 55120'],f'fuel-{P.lower()}-2002')
doc(f'toll-{P}-2002.pdf','KANSAS TURNPIKE AUTHORITY',[f'Date {D(10,14)}  Unit 207',f'Load {P}-2002','Class 5 toll','TOTAL $18.25','Receipt # KT-9932'],f'toll-{P.lower()}-2002')
doc(f'ratecon-{P}-2002.pdf','RATE CONFIRMATION',['Blue Ridge Logistics  MC# 500100',f'Load # {P}-2002',CAR,'Driver: Tina Alvarez  Truck 207',
  f'Pickup: Tulsa Mill, Tulsa, OK  {D(10,14)}',f'Delivery: Front Range DC, Denver, CO  {D(10,15)}','Miles: 680','Line Haul: $2,400.00','Total Carrier Pay: $2,400.00'],f'rc-{P.lower()}-2002')
print(sorted(os.listdir(OUT)))
