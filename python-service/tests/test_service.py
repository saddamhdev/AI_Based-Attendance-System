import os,sys,unittest,io,tempfile
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
 def test_missing_models_explicit(self):
  if service.DETECTOR_MODEL.exists():self.skipTest('Models installed')
  self.assertEqual(self.c.post('/recognize',headers=self.h,files=[('images',('x.jpg',b'x','image/jpeg'))]).status_code,503)
 def test_invalid_image(self):
  from starlette.datastructures import UploadFile
  with self.assertRaises(service.HTTPException):service.decode(UploadFile(io.BytesIO(b'not an image')))
 def test_valid_image_decode(self):
  from starlette.datastructures import UploadFile
  b=io.BytesIO();Image.new('RGB',(32,32)).save(b,format='PNG');b.seek(0)
  self.assertEqual(service.decode(UploadFile(b)).shape,(32,32,3))
if __name__=='__main__':unittest.main()
