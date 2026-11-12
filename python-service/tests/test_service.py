import os,sys,unittest,io,tempfile
from unittest.mock import patch
from pathlib import Path
os.environ['DATA_DIR']=tempfile.mkdtemp()
os.environ['AI_SERVICE_KEY']='test-only-key'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
import app as service
class ServiceTests(unittest.TestCase):
 def setUp(self):self.c=TestClient(service.app);self.h={'X-Service-Key':'test-only-key'}
 def test_auth(self):self.assertEqual(self.c.get('/health').status_code,401)
 def test_health(self):self.assertEqual(self.c.get('/health',headers=self.h).status_code,200)
 def test_invalid_identifier(self):self.assertEqual(self.c.delete('/enroll/not-a-uuid',headers=self.h).status_code,400)
 def test_idempotent_deletion(self):
  for _ in range(2):self.assertEqual(self.c.delete('/enroll/00000000-0000-0000-0000-000000000001',headers=self.h).status_code,200)
 def test_staged_activation_and_exists(self):
  student='00000000-0000-0000-0000-000000000002';version='00000000-0000-0000-0000-000000000003'
  import numpy as np
  np.save(Path(os.environ['DATA_DIR'])/(student+'.'+version+'.npy'),np.zeros(4))
  self.assertEqual(self.c.get('/enroll/'+student+'/exists',headers=self.h).json()['enrolled'],False)
  self.assertEqual(self.c.post('/enroll/'+student+'/activate?version='+version,headers=self.h).status_code,200)
  self.assertEqual(self.c.get('/enroll/'+student+'/exists',headers=self.h).json()['enrolled'],True)
  self.assertEqual(self.c.delete('/enroll/'+student+'?version='+version,headers=self.h).status_code,200)
 def test_missing_models_explicit(self):
  if service.DETECTOR_MODEL.exists():self.skipTest('Models installed')
  self.assertEqual(self.c.post('/recognize',headers=self.h,files=[('images',('x.jpg',b'x','image/jpeg'))],data={'thresholdPercentage':'70'}).status_code,503)
 def test_invalid_image(self):
  from starlette.datastructures import UploadFile
  with self.assertRaises(service.HTTPException):service.decode(UploadFile(io.BytesIO(b'not an image')))
 def test_enrollment_error_identifies_photo_index(self):
  with patch.object(service,'models'),patch.object(service,'create_recognizer',return_value=object()):
   response=self.c.post('/enroll/00000000-0000-0000-0000-000000000004?version=00000000-0000-0000-0000-000000000005',headers=self.h,files=[('images',('one.jpg',b'not an image','image/jpeg'))]*5)
  self.assertEqual(response.status_code,422)
  detail=response.json()['detail']
  self.assertEqual(detail['code'],'FACE_PHOTO_VALIDATION_FAILED')
  self.assertEqual([issue['photoIndex'] for issue in detail['photoErrors']],[1,2,3,4,5])
  self.assertTrue(all(issue['code']=='INVALID_IMAGE' for issue in detail['photoErrors']))
 def test_enrollment_collects_photo_specific_face_failures_without_staging_embedding(self):
  import numpy as np
  student='00000000-0000-0000-0000-000000000020'
  version='00000000-0000-0000-0000-000000000021'
  face=np.zeros(15);face[2:4]=40;face[14]=0.99
  small_face=face.copy();small_face[2:4]=20
  files=[('images',(f'{index}.jpg',b'image','image/jpeg')) for index in range(5)]
  with patch.object(service,'models'),patch.object(service,'create_recognizer',return_value=object()),\
       patch.object(service,'decode',return_value=np.zeros((40,40,3))),\
       patch.object(service,'detect',side_effect=[[],[face,face],[small_face],[face],[face]]):
   response=self.c.post(f'/enroll/{student}?version={version}',headers=self.h,files=files)
  self.assertEqual(response.status_code,422)
  errors=response.json()['detail']['photoErrors']
  self.assertEqual([(issue['photoIndex'],issue['code']) for issue in errors],
                   [(1,'NO_DETECTABLE_FACE'),(2,'MULTIPLE_FACES'),(3,'LOW_QUALITY')])
  self.assertFalse((Path(os.environ['DATA_DIR'])/(student+'.'+version+'.npy')).exists())
 def test_valid_image_decode(self):
  from starlette.datastructures import UploadFile
  b=io.BytesIO();Image.new('RGB',(32,32)).save(b,format='PNG');b.seek(0)
  self.assertEqual(service.decode(UploadFile(b)).shape,(32,32,3))
 def test_similarity_score_preserves_raw_precision(self):
  import numpy as np
  result=service.find_best_student(np.array([1.0]),{'student':np.array([0.70004])},0.70)
  self.assertEqual(result['status'],'MATCHED')
  self.assertEqual(result['score'],0.70004)
 def test_threshold_is_inclusive_and_raw_score_is_not_rounded(self):
  import numpy as np
  result=service.find_best_student(np.array([1.0]),{'student':np.array([0.70004])},0.70004)
  self.assertEqual(result['status'],'MATCHED')
  below=service.find_best_student(np.array([1.0]),{'student':np.array([0.70004])},0.70005)
  self.assertEqual(below['status'],'UNKNOWN')
  self.assertEqual(below['score'],0.70004)
 def test_ambiguity_margin_still_requires_manual_review(self):
  import numpy as np
  result=service.find_best_student(np.array([1.0,0.0]),{
   'student-a':np.array([1.0,0.0]),'student-b':np.array([1.0,0.0])},0.70)
  self.assertEqual(result['status'],'UNCERTAIN')
  self.assertEqual(result['studentId'],'student-a')
 def test_recognition_rejects_missing_nonnumeric_nonfinite_and_out_of_range_threshold(self):
  image=('images',('class.jpg',b'image','image/jpeg'))
  for data in ({}, {'thresholdPercentage':'word'}, {'thresholdPercentage':'nan'},
               {'thresholdPercentage':'inf'}, {'thresholdPercentage':'0.99'},
               {'thresholdPercentage':'100.01'}):
   response=self.c.post('/recognize',headers=self.h,files=[image],data=data)
   self.assertEqual(response.status_code,422,data)
 def test_concurrent_recognition_requests_keep_request_thresholds_isolated(self):
  import numpy as np
  from concurrent.futures import ThreadPoolExecutor
  student='00000000-0000-0000-0000-000000000010'
  np.save(Path(os.environ['DATA_DIR'])/(student+'.npy'),np.array([0.70,np.sqrt(0.51)]))
  face=np.zeros(15);face[2:4]=40;face[14]=0.99
  image=('images',('class.jpg',b'image','image/jpeg'))
  def request(threshold):
   return self.c.post('/recognize',headers=self.h,files=[image],
                      data={'studentIds':student,'thresholdPercentage':str(threshold)})
  with patch.object(service,'models'),patch.object(service,'decode',return_value=np.zeros((40,40,3))),\
       patch.object(service,'detect',return_value=[face]),patch.object(service,'create_recognizer',return_value=object()),\
       patch.object(service,'embedding',return_value=np.array([1.0,0.0])),\
       patch.object(service,'normalize_embedding',side_effect=lambda vector:np.asarray(vector)):
   with ThreadPoolExecutor(max_workers=2) as pool:
    responses=list(pool.map(request,[70,71]))
  self.assertEqual([response.status_code for response in responses],[200,200])
  payloads=[response.json()['photos'][0]['results'][0] for response in responses]
  self.assertEqual([result['status'] for result in payloads],['MATCHED','UNKNOWN'])
 def test_same_photo_duplicate_identity_matches_are_blocked(self):
  import numpy as np
  student='00000000-0000-0000-0000-000000000011'
  np.save(Path(os.environ['DATA_DIR'])/(student+'.npy'),np.array([1.0,0.0]))
  face=np.zeros(15);face[2:4]=40;face[14]=0.99
  with patch.object(service,'models'),patch.object(service,'decode',return_value=np.zeros((80,80,3))),\
       patch.object(service,'detect',return_value=[face,face]),patch.object(service,'create_recognizer',return_value=object()),\
       patch.object(service,'embedding',return_value=np.array([1.0,0.0])):
   response=self.c.post('/recognize',headers=self.h,
    files=[('images',('class.jpg',b'image','image/jpeg'))],
    data={'studentIds':student,'thresholdPercentage':'70'})
  self.assertEqual(response.status_code,200)
  results=response.json()['photos'][0]['results']
  self.assertEqual([result['status'] for result in results],['UNCERTAIN','UNCERTAIN'])
  self.assertEqual(response.json()['matchedStudentIds'],[])
if __name__=='__main__':unittest.main()
