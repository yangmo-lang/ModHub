const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const a = require('../electron/onedragon-apps.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-odapp-'));
  const app = (dir, file, text) => { const d = path.join(root, 'src', 'zzz_od', 'application', dir); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, file), text); };
  app('random_play', 'random_play_config.py', "class P(Enum):\n    POINT_1 = TransportPoint('录像店', '柜台')\n    POINT_2 = TransportPoint('澄辉坪', '录像店营业点')\n");
  app('coffee', 'coffee_config.py', "    POINT_1 = TransportPoint('六分街', '咖啡店')\n    POINT_3 = TransportPoint('布亚斯特城区', '片刻闲')\n");
  fs.mkdirSync(path.join(root, 'assets', 'game_data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'game_data', 'compendium_data.yml'), yaml.dump([
    { tab_name: '日常' },
    { tab_name: '训练', category_list: [
      { category_name: '实战模拟室', mission_type_list: [
        { mission_type_name: '基础材料', mission_list: [{ mission_name: '调查专项', mission_name_display: '代理人经验' }, { mission_name: '镀剂专项' }] },
        { mission_type_name: '自定义模板', mission_list: [{ mission_name: '自定义卡组1' }] },
      ] },
      { category_name: '区域巡防', mission_type_list: [{ mission_type_name: '迅脊与裂爪', mission_type_name_display: '谶羽之誓 荆棘玫瑰' }] },
      { category_name: '恶名狩猎', mission_type_list: [{ mission_type_name: '冥宁芙·双子' }, { mission_type_name: '代理人方案培养' }] },
      { category_name: '合成电池' },
    ] },
  ]));
  fs.mkdirSync(path.join(root, 'config', '01', 'one_dragon'), { recursive: true });
  return root;
}

test('選項：傳送地點與副本從安裝目錄讀，略過需要另外設定的類型', () => {
  const root = fixture();
  const o = a.readOptions(root);
  assert.deepEqual(o.transport.random_play, ['录像店 - 柜台', '澄辉坪 - 录像店营业点']);
  assert.deepEqual(o.compendium.map((c) => [c.category, c.types.map((t) => t.name)]), [['实战模拟室', ['基础材料']], ['区域巡防', ['迅脊与裂爪']], ['恶名狩猎', ['冥宁芙·双子']]]);
  assert.equal(o.compendium[1].types[0].drop, '谶羽之誓、荆棘玫瑰', '區域巡防的驅動盤套裝');
  assert.deepEqual(o.compendium[0].types[0].drops, { 调查专项: '代理人经验' }, '實戰模擬室的產出；沒標註的不列');
  assert.equal(o.compendium[2].types[0].drop, '', '沒有資料就不顯示');
  assert.equal(a.readAppConfig(root, 1, 'charge_plan').labels['谶羽之誓、荆棘玫瑰'], '讖羽之誓、荊棘玫瑰');
  const r = a.readAppConfig(root, 1, 'coffee');
  assert.equal(r.transport_point, '六分街 - 咖啡店', '沒有設定時用第一個（OneDragon 預設）');
  assert.equal(r.labels['布亚斯特城区 - 片刻闲'], '布亞斯特城區 - 片刻閒');
});

test('改地點：只改 transport_point、其他保留；不認得的地點拒絕', () => {
  const root = fixture();
  const f = a.appFile(root, 1, 'coffee');
  fs.writeFileSync(f, yaml.dump({ transport_point: '六分街 - 咖啡店', run_charge_plan_afterwards: true }));
  a.writeAppConfig(root, 1, 'coffee', { transport_point: '布亚斯特城区 - 片刻闲' });
  assert.deepEqual(yaml.load(fs.readFileSync(f, 'utf8')), { transport_point: '布亚斯特城区 - 片刻闲', run_charge_plan_afterwards: true });
  assert.ok(fs.existsSync(`${f}.modhub-bak`));
  assert.throws(() => a.writeAppConfig(root, 1, 'coffee', { transport_point: '月球' }), /不認得/);
  a.writeAppConfig(root, 1, 'random_play', { transport_point: '澄辉坪 - 录像店营业点' });
  assert.equal(yaml.load(fs.readFileSync(a.appFile(root, 1, 'random_play'), 'utf8')).transport_point, '澄辉坪 - 录像店营业点', '檔案不存在就建立');
});

test('體力刷本：新增計畫用預設戰鬥設定，既有計畫只改次數，保留其他欄位', () => {
  const root = fixture();
  const f = a.appFile(root, 1, 'charge_plan');
  fs.writeFileSync(f, yaml.dump({ double_reward: false, plan_list: [{ ...a.PLAN_DEFAULTS, category_name: '实战模拟室', mission_type_name: '基础材料', mission_name: '调查专项', plan_times: 1, predefined_team_idx: 2, card_num: '5', plan_id: 'old-1' }] }));
  const r = a.writeAppConfig(root, 1, 'charge_plan', { plan_list: [
    { category_name: '恶名狩猎', mission_type_name: '冥宁芙·双子', mission_name: null, plan_times: 2 },
    { plan_id: 'old-1', category_name: '实战模拟室', mission_type_name: '基础材料', mission_name: '调查专项', plan_times: '5' },
  ] });
  const doc = yaml.load(fs.readFileSync(f, 'utf8'));
  assert.equal(doc.double_reward, false);
  assert.equal(doc.plan_list.length, 2);
  assert.equal(doc.plan_list[0].mission_name, null);
  assert.equal(doc.plan_list[0].auto_battle_config, '全配队通用');
  assert.equal(doc.plan_list[0].tab_name, '训练');
  assert.ok(doc.plan_list[0].plan_id && doc.plan_list[0].plan_id !== 'old-1');
  assert.deepEqual([doc.plan_list[1].plan_id, doc.plan_list[1].plan_times, doc.plan_list[1].predefined_team_idx, doc.plan_list[1].card_num], ['old-1', 5, 2, '5']);
  assert.equal(r.plan_list.length, 2);
  // 換副本：保留配隊，其餘重設
  a.writeAppConfig(root, 1, 'charge_plan', { plan_list: [{ plan_id: 'old-1', category_name: '实战模拟室', mission_type_name: '基础材料', mission_name: '镀剂专项', plan_times: 1 }] });
  const p = yaml.load(fs.readFileSync(f, 'utf8')).plan_list[0];
  assert.deepEqual([p.mission_name, p.predefined_team_idx, p.card_num, p.plan_id], ['镀剂专项', 2, '默认数量', 'old-1']);
  assert.throws(() => a.writeAppConfig(root, 1, 'charge_plan', { plan_list: [{ category_name: '实战模拟室', mission_type_name: '基础材料', mission_name: '不存在', plan_times: 1 }] }), /不認得這個副本/);
  assert.throws(() => a.writeAppConfig(root, 1, 'email', {}), /沒有可以在 ModHub 調整/);
});

test('每日簽到：地點從安裝目錄的設定介面讀，讀不到用內建三個；只接受清單裡的', () => {
  const root = fixture();
  const r0 = a.readAppConfig(root, 1, 'daily_signin');
  assert.deepEqual(r0.options, ['hou_hou_bakery', 'trigrams_collection', 'scratch_card']);
  assert.equal(r0.selected_sign, 'hou_hou_bakery');
  assert.equal(r0.labels.trigrams_collection, '卦象集錄');
  const d = path.join(root, 'src', 'zzz_od', 'gui', 'app_setting');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'daily_signin_setting_flyout.py'), "options=[\n  ConfigItem('刮刮卡', 'scratch_card'),\n  ConfigItem('新地点', 'new_place'),\n]\n");
  assert.deepEqual(a.readSignOptions(root).map((o) => o.value), ['scratch_card', 'new_place']);
  a.writeAppConfig(root, 1, 'daily_signin', { selected_sign: 'new_place' });
  assert.equal(yaml.load(fs.readFileSync(a.appFile(root, 1, 'daily_signin'), 'utf8')).selected_sign, 'new_place');
  assert.throws(() => a.writeAppConfig(root, 1, 'daily_signin', { selected_sign: 'hou_hou_bakery' }), /不認得/);
});
