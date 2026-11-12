import os, uuid, tempfile, math
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Depends
from core import create_detector,create_recognizer,normalize_embedding,find_best_student,DETECTOR_MODEL,RECOGNIZER_MODEL
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
    if not DETECTOR_MODEL.exists() or not RECOGNIZER_MODEL.exists():
        raise HTTPException(503,detail={"code":"AI_MODEL_UNAVAILABLE","message":"Face processing is temporarily unavailable."})
def decode(file):
    raw=file.file.read(MAX+1)
    if not raw:raise HTTPException(400,detail={"code":"INVALID_IMAGE","message":"The image is empty."})
    if len(raw)>MAX:raise HTTPException(413,detail={"code":"FILE_TOO_LARGE","message":"The image exceeds the 10 MB limit."})
    # Check encoded dimensions before decoding to limit decompression allocations.
    from PIL import Image
    import io
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.format not in {"JPEG","PNG"}:raise HTTPException(415,detail={"code":"UNSUPPORTED_FORMAT","message":"Use a JPEG or PNG image."})
            if im.width*im.height>24000000:raise HTTPException(413,detail={"code":"IMAGE_TOO_LARGE","message":"Image dimensions must not exceed 24 megapixels."})
            if im.width<30 or im.height<30:raise HTTPException(400,detail={"code":"IMAGE_TOO_SMALL","message":"The image must be at least 30 by 30 pixels."})
            im.verify()
    except HTTPException:raise
    except Exception as error:raise HTTPException(400,detail={"code":"INVALID_IMAGE","message":"The image is not a valid JPEG or PNG."}) from error
    image=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
    if image is None:raise HTTPException(400,detail={"code":"INVALID_IMAGE","message":"The image could not be decoded."})
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
    if not 5<=len(images)<=10:
        raise HTTPException(400,detail={"code":"PHOTO_COUNT_INVALID","message":"Select between 5 and 10 photos."})
    prepared=[];photo_errors=[];recognizer=create_recognizer()
    for index,f in enumerate(images,1):
        try:
            im=decode(f);faces=detect(im)
            if len(faces)==0:
                photo_errors.append({"photoIndex":index,"code":"NO_DETECTABLE_FACE","message":"has no detectable face."})
            elif len(faces)>1:
                photo_errors.append({"photoIndex":index,"code":"MULTIPLE_FACES","message":"contains multiple faces."})
            elif min(faces[0][2:4])<30:
                photo_errors.append({"photoIndex":index,"code":"LOW_QUALITY","message":"contains a face that is too small."})
            else:
                prepared.append((index,im,faces[0]))
        except HTTPException as error:
            detail=error.detail if isinstance(error.detail,dict) else {"code":"INVALID_IMAGE","message":"could not be processed."}
            photo_errors.append({"photoIndex":index,"code":detail.get("code","INVALID_IMAGE"),"message":detail.get("message","could not be processed.")})
        except (cv2.error,ValueError):
            photo_errors.append({"photoIndex":index,"code":"PROCESSING_FAILED","message":"could not be processed."})
    if photo_errors:
        raise HTTPException(422,detail={
            "code":"FACE_PHOTO_VALIDATION_FAILED",
            "message":"Some photos need to be replaced.",
            "photoErrors":photo_errors,
        })
    vectors=[]
    for index,im,face in prepared:
        try:
            vectors.append(embedding(im,face,recognizer))
        except (cv2.error,ValueError):
            photo_errors.append({"photoIndex":index,"code":"PROCESSING_FAILED","message":"could not be processed."})
    if photo_errors:
        raise HTTPException(422,detail={
            "code":"FACE_PHOTO_VALIDATION_FAILED",
            "message":"Some photos need to be replaced.",
            "photoErrors":photo_errors,
        })
    vector=normalize_embedding(np.mean(vectors,axis=0))
    suffix="."+version if version else ""
    fd,name=tempfile.mkstemp(dir=DATA,suffix=".npy")
    try:
        with os.fdopen(fd,"wb") as stream:np.save(stream,vector,allow_pickle=False)
        os.replace(name,DATA/(student_id+suffix+".npy"))
    except OSError as error:
        raise HTTPException(503,detail={"code":"ENROLLMENT_STORAGE_FAILED","message":"The face template could not be staged. Retry the upload."}) from error
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
def recognize(images:list[UploadFile]=File(...),studentIds:str=Form(default=""),thresholdPercentage:float=Form(...,alias="thresholdPercentage")):
    if not math.isfinite(thresholdPercentage) or not 1<=thresholdPercentage<=100:
        raise HTTPException(422,"Threshold must be a finite percentage from 1 to 100")
    threshold=thresholdPercentage/100
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
                try:result=find_best_student(embedding(im,face,recognizer),students,threshold)
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
