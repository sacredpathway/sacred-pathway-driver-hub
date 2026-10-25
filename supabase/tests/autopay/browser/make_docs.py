from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import os
OUT='docs'
def doc(name, title, lines, key):
    c=canvas.Canvas(os.path.join(OUT,name), pagesize=letter, pageCompression=0)
    c.setFont('Helvetica-Bold',18); c.drawString(54,740,title)
    c.setFont('Helvetica',11); y=710
    for l in lines:
        c.drawString(54,y,l); y-=18
    c.setFont('Helvetica',6); c.drawString(54,40,f'SYNTHETIC TEST DOCUMENT - not a real load. KEY:{key}')
    c.save()
CAR='Carrier: AP Synthetic Freight LLC   MC# 771234'
doc('ratecon-APB-1001.pdf','RATE CONFIRMATION',[ 'Blue Ridge Logistics  MC# 500100','Load # APB-1001',CAR,'Driver: Marcus Reed  Truck 112',
  'Pickup: Acme Foods, Dallas, TX  10/13/2026','Delivery: HEB DC, Houston, TX  10/14/2026','Miles: 240','Line Haul: $1,850.00','Fuel Surcharge: $0.00','Total Carrier Pay: $1,850.00'],'rc-apb-1001')
doc('pod-APB-1001.pdf','PROOF OF DELIVERY',['Load # APB-1001   BOL # BOL-APB-1001',CAR,'Shipper: Acme Foods, Dallas, TX  10/13/2026','Consignee: HEB DC, Houston, TX  10/14/2026','Received in good order - signed: J. Ortiz'],'pod-apb-1001')
doc('fuel-APB-1001.pdf','PILOT TRAVEL CENTER #452',['Date 10/14/2026  Unit 112','Load APB-1001','Diesel 101.20 gal @ 4.073','TOTAL $412.18','Receipt # 88231'],'fuel-apb-1001')
doc('pod-APB-2002.pdf','PROOF OF DELIVERY',['Load # APB-2002   BOL # BOL-APB-2002',CAR,'Shipper: Tulsa Mill, Tulsa, OK  10/14/2026','Consignee: Front Range DC, Denver, CO  10/15/2026','Received - signed: K. Lee'],'pod-apb-2002')
doc('fuel-APB-2002.pdf','LOVES TRAVEL STOP #611',['Date 10/14/2026  Unit 207','Load APB-2002','Diesel 98.10 gal','TOTAL $398.40','Receipt # 55120'],'fuel-apb-2002')
doc('toll-APB-2002.pdf','KANSAS TURNPIKE AUTHORITY',['Date 10/14/2026  Unit 207','Load APB-2002','Class 5 toll','TOTAL $18.25','Receipt # KT-9932'],'toll-apb-2002')
doc('ratecon-APB-2002.pdf','RATE CONFIRMATION',['Blue Ridge Logistics  MC# 500100','Load # APB-2002',CAR,'Driver: Tina Alvarez  Truck 207',
  'Pickup: Tulsa Mill, Tulsa, OK  10/14/2026','Delivery: Front Range DC, Denver, CO  10/15/2026','Miles: 680','Line Haul: $2,400.00','Total Carrier Pay: $2,400.00'],'rc-apb-2002')
print(sorted(os.listdir(OUT)))
