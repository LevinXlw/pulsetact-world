import {describe,it,expect} from 'vitest';
import {creditStrings,degreesToRadians,googleFailure,MIT_VIEW,moveCalibrationAvatar,viewSettings} from '../src/features/real-campus/config';
import {TilesRenderer} from '3d-tiles-renderer/three';
import {ReorientationPlugin} from '3d-tiles-renderer/three/plugins';
import {Vector3} from 'three';
describe('real campus adapter',()=>{
  it('converts the independently configured geographic anchor to the local origin',()=>{
    const tiles=new TilesRenderer();const plugin=new ReorientationPlugin({lat:degreesToRadians(MIT_VIEW.latitude),lon:degreesToRadians(MIT_VIEW.longitude),height:MIT_VIEW.ellipsoidHeight});
    tiles.registerPlugin(plugin);
    plugin.transformLatLonHeightToOrigin(degreesToRadians(MIT_VIEW.latitude),degreesToRadians(MIT_VIEW.longitude),MIT_VIEW.ellipsoidHeight);
    const location=new Vector3();tiles.ellipsoid.getCartographicToPosition(degreesToRadians(MIT_VIEW.latitude),degreesToRadians(MIT_VIEW.longitude),MIT_VIEW.ellipsoidHeight,location);
    expect(location.applyMatrix4(tiles.group.matrixWorld).length()).toBeLessThan(.001);tiles.dispose();
  });
  it('keeps browser request details out of displayed failures',()=>{
    const text=googleFailure(new Error('403 https://tile.googleapis.com/?key=private-test-value'));
    expect(text).toContain('Google 拒绝');expect(text).not.toContain('private-test-value');expect(text).not.toContain('https:');expect(googleFailure(new Error('429 quota'))).toContain('配额');
  });
  it('uses complete sorted attribution strings without HTML execution or fabricated credits',()=>{
    expect(creditStrings([{type:'string',value:'Z provider'},{type:'string',value:'A provider'},{type:'string',value:'Z provider'},{type:'image',value:'bad-url'}])).toEqual(['A provider','Z provider']);expect(creditStrings([])).toEqual([]);
  });
  it('bounds the independent calibration plane and normalizes movement',()=>{
    const straight=moveCalibrationAvatar(0,0,1,0,.05),diagonal=moveCalibrationAvatar(0,0,1,1,.05);expect(Math.hypot(...straight)).toBeCloseTo(Math.hypot(...diagonal));expect(moveCalibrationAvatar(12,18,1,1,10)).toEqual([12,18]);expect(viewSettings.aerial.distance).toBeGreaterThan(viewSettings.avatar.distance);
  });
});
