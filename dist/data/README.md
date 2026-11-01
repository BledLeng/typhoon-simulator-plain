# 地图底板数据

## 使用的文件

`ne_50m_land.geojson` 是网站运行时使用的真实陆地面数据：

- 数据集：Natural Earth **1:50m Land**（1:50,000,000，非 50 米精度）。
- 全球覆盖，不在西北太平洋视口边缘截断陆地，便于不同屏幕比例自适应。
- GeoJSON `FeatureCollection`，几何类型为 `Polygon` / `MultiPolygon`。
- WGS84 经度、纬度，坐标顺序为 `[longitude, latitude]`，单位为度。
- 1,420 个 feature、1,421 个 polygon、60,669 个顶点；1,392,647 字节。
- 只包含陆地面，不包含国界、省界、领海线或地名归属信息。
- 保留源数据中全部海岛、面、环和顶点；只将坐标保留到小数点后 5 位，并规范环方向，没有几何简化、人工海岸线或区域裁切。
- 作为中等比例尺概览底图使用；源数据本身并不包含世界上每一座微小岛屿，不适合海岸工程、导航或高精度距离测量。

## 台湾地形补丁

`taiwan-elevation.i16`：512×768 的有符号 16 位米制 DEM，来自 Mapzen / Tilezen Terrarium zoom 7 的六个原始瓦片（x=106–107，y=54–56），约 1.1km 格距。用于补充 `elevation.i16` 全球约 20km 地形。边缘平滑过渡到全球数据，不替换海岸线，不把栅格高程当作精确山峰高度或完整三维流场。

`taiwan-elevation.json` 记录瓦片、下载日期和 SHA-256；重建时生成器会下载并缓存原始 PNG 到 `data-source/taiwan-terrain/`。生成器：`tools/build-taiwan-terrain.mjs`。来源说明及署名：[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)、[Tilezen 数据归属](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)。

## 来源与授权

来源为 Natural Earth 官方 [1:50m Land 图层说明](https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/)。该图层来自其 1:10m 海岸线数据，包括主要岛屿。官方下载页面显示的旧版本标签为 4.0.0；本项目下载的原始档案内 `ne_50m_land.VERSION.txt` 实际标记为 **4.1.0**，这里以档案内版本为准。

下载地址：NACIS 托管的 [Natural Earth 50m physical land ZIP](https://naciscdn.org/naturalearth/50m/physical/ne_50m_land.zip)。[AWS 开放数据登记页](https://registry.opendata.aws/naturalearth/)亦确认 Natural Earth 由 NACIS 管理，并提供公开的原始 Shapefile 档案。

Natural Earth 官方 [Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/) 将其地图数据置于公有领域（public domain），允许个人、教育及商业使用，允许修改和公开分发，无须另行许可或强制署名。建议在产品说明中保留自愿署名：**Made with Natural Earth.**

来源及条款核查日期：2026-10-29。原始档案保留在项目源码的 `data-source/ne_50m_land.source.zip`，其中附有上游 README、版本、投影与 Shapefile 文件，便于独立核查与再生成。原始 ZIP 不放在公开网页根目录中。

## 校验与再生成

源 ZIP SHA-256：

```text
0b8e670cf80dce9cbebe2a193bc44ba5602758c22e1fa603980553646d7ff162
```

GeoJSON SHA-256：

```text
4e2172da4fc08dcbd30dc4f7771809669608de6f6af724b028c7ece0b7dd63a5
```

转换工具为项目源码中的 `data-source/generate_land.py`，只在开发时使用 Python 与固定版本的 `pyshp`。网页运行时不需要 Python，不请求第三方地图服务。源 ZIP 已随项目源码保存，通常不必重新下载。

从项目根目录运行：

```sh
python3 -m venv /tmp/typhoon-map-data-venv
/tmp/typhoon-map-data-venv/bin/python -m pip install pyshp==2.3.1
/tmp/typhoon-map-data-venv/bin/python data-source/generate_land.py
```

仅在原始 ZIP 丢失时重新下载：

```sh
curl -fL --retry 2 https://naciscdn.org/naturalearth/50m/physical/ne_50m_land.zip -o data-source/ne_50m_land.source.zip
```

转换脚本强制核对源 ZIP 校验和；上游发生变化时会停止，要求先复核版本和数据，避免静默变更。输出为紧凑 JSON，移除无需用于地图着色的上游属性；`properties` 为空对象。

## 绘制注意事项

1. 各 polygon 的第一个环为陆地外环，其余环为洞。外环逆时针，内环顺时针；Canvas 可使用 `fill('evenodd')` 正确保留洞。
2. Mercator 投影应使用纬度弧度及对数变换。全球数据含南极；投影时将纬度限制在约 ±85.051129°，避免极点的无穷值。
3. 陆地是面数据，不是独立海岸线线段数据。不要把包含日期变更线裁切边或大陆分块边的每一条面边都当作真实海岸线。
4. 对西北太平洋地图，保持东经一侧的连续坐标域。若实现跨越 ±180° 的视口，必须正确处理反经线分割与世界副本，不能将相邻世界的坐标直接跨屏相连。
5. 视口裁切应在投影绘制阶段进行；不要以粗略手绘多边形覆盖本数据中的海岸细节。
