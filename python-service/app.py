import os, uuid, tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Depends
from core import create_detector,create_recognizer,normalize_embedding,find_best_student,remove_duplicate_student_matches,DETECTOR_MODEL,RECOGNIZER_MODEL
app=FastAPI(title="Attendance AI")
DATA=Path(os.getenv("DATA_DIR","/app/data"));DATA.mkdir(parents=True,exist_ok=True)
MAX=10*1024*1024

def auth(x_service_key: str=Header(default="")):
    key=os.environ.get("AI_SERVICE_KEY","")
    import hmac
    if not key or not hmac.compare_digest(key,x_service_key):raise HTTPException(401,"Invalid service key")
def uid(value):
    try:return str(uuid.UUID(value))
    except ValueError:raise HTTPException(400,"Invalid student ID")
def models():
    if not DETECTOR_MODEL.exists() or not RECOGNIZER_MODEL.exists():raise HTTPException(503,"YuNet/SFace model files missing. Manual attendance remains available.")
def decode(file):
    raw=file.file.read(MAX+1)
    if not raw or len(raw)>MAX:raise HTTPException(413,"Image empty or exceeds 10 MB")
    # Check encoded dimensions before decoding to limit decompression allocations.
    from PIL import Image
    import io
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.format not in {"JPEG","PNG"} or im.width*im.height>24000000:raise ValueError()
            im.verify()
    except Exception:raise HTTPException(400,"Use a valid JPEG/PNG up to 24 megapixels")
    image=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
    if image is None:raise HTTPException(400,"Invalid image")
    return image

def detect(im):
    h,w=im.shape[:2];_,faces=create_detector(w,h).detect(im)
    return [] if faces is None else faces

def embedding(im,face,recognizer):return normalize_embedding(recognizer.feature(recognizer.alignCrop(im,face)))

@app.get("/health",dependencies=[Depends(auth)])
def health():return {"modelsReady":DETECTOR_MODEL.exists() and RECOGNIZER_MODEL.exists()}

@app.post("/enroll/{student_id}",dependencies=[Depends(auth)])
def enroll(student_id:str,images:list[UploadFile]=File(...),version:str=""):
    student_id=uid(student_id);models()
    if not 5<=len(images)<=10:raise HTTPException(400,"Require 5–10 photos")
    vectors=[];recognizer=create_recognizer()
    for index,f in enumerate(images,1):
        try:
            im=decode(f);faces=detect(im)
            if len(faces)!=1:raise HTTPException(400,"Each enrollment image must contain exactly one face")
            if min(faces[0][2:4])<30:raise HTTPException(400,"Face too small")
            vectors.append(embedding(im,faces[0],recognizer))
        except HTTPException as error:
            raise HTTPException(error.status_code,f"Photo {index}: {error.detail}") from error
    vector=normalize_embedding(np.mean(vectors,axis=0))
    suffix="."+version if version else ""
    fd,name=tempfile.mkstemp(dir=DATA,suffix=".npy")
    try:
        with os.fdopen(fd,"wb") as stream:np.save(stream,vector,allow_pickle=False)
        os.replace(name,DATA/(student_id+suffix+".npy"))
    finally:
        if os.path.exists(name):os.unlink(name)
    return {"studentId":student_id,"acceptedPhotos":len(vectors)}

@app.post("/enroll/{student_id}/activate",dependencies=[Depends(auth)])
def activate(student_id:str,version:str):
    student_id=uid(student_id);version=uid(version)
    source=DATA/(student_id+"."+version+".npy")
    if not source.exists():raise HTTPException(404,"Staged enrollment not found")
    temp=DATA/(student_id+".active.tmp")
    temp.write_text(version,encoding="ascii")
    os.replace(temp,DATA/(student_id+".active"))
    return {"activated":True}

@app.get("/enroll/{student_id}/exists",dependencies=[Depends(auth)])
def exists(student_id:str):
    student_id=uid(student_id)
    active=DATA/(student_id+".active")
    if active.exists():
        version=active.read_text(encoding="ascii").strip()
        return {"enrolled":(DATA/(student_id+"."+version+".npy")).exists()}
    return {"enrolled":(DATA/(student_id+".npy")).exists()}

@app.delete("/enroll/{student_id}",dependencies=[Depends(auth)])
def delete(student_id:str,version:str=""):
    student_id=uid(student_id)
    if version:version=uid(version)
    for path in ([DATA/(student_id+"."+version+".npy")] if version else DATA.glob(student_id+"*.npy")):path.unlink(missing_ok=True)
    if not version:(DATA/(student_id+".active")).unlink(missing_ok=True)
    return {"deleted":True}

@app.post("/recognize",dependencies=[Depends(auth)])
def recognize(images:list[UploadFile]=File(...),studentIds:str=Form(default="")):
    models()
    if not 1<=len(images)<=3:raise HTTPException(400,"Require 1–3 group photos")
    students={}
    for id in filter(None,studentIds.split(',')):
        id=uid(id);path=DATA/(id+".npy")
        active=DATA/(id+".active")
        if active.exists():
            path=DATA/(id+"."+active.read_text(encoding="ascii").strip()+".npy")
        else:path=DATA/(id+".npy")
        if path.exists():students[id]=normalize_embedding(np.load(path,allow_pickle=False))
    photos=[];matched=set();blocked=set();recognizer=create_recognizer()
    for file in images:
        im=decode(file);h,w=im.shape[:2];results=[];photo_id=str(uuid.uuid4())
        for index,face in enumerate(detect(im),1):
            x,y,fw,fh=map(int,face[:4]);base={"faceNumber":index,"faceId":photo_id+":"+str(index),"boundingBox":{"x":x,"y":y,"width":fw,"height":fh},"detectionConfidence":float(face[14])}
            if min(fw,fh)<30:result={"status":"LOW_QUALITY","studentId":None}
            else:
                try:result=find_best_student(embedding(im,face,recognizer),students)
                except (cv2.error,ValueError):result={"status":"PROCESSING_FAILED","studentId":None}
            results.append({**base,**result})
        # Any within-photo identity collision requires human review; do not silently choose.
        counts={}
        for item in results:
            if item.get("studentId"):counts[item["studentId"]]=counts.get(item["studentId"],0)+1
        for item in results:
            if item.get("studentId") and counts[item["studentId"]]>1:
                item["status"]="UNCERTAIN";blocked.add(item["studentId"])
            if item["status"]=="MATCHED":matched.add(item["studentId"])
        photos.append({"photoId":photo_id,"imageWidth":w,"imageHeight":h,"results":results})
    return {"photos":photos,"matchedStudentIds":sorted(matched-blocked),"attendanceStatus":"PROPOSED"}
