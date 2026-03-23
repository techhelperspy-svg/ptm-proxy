const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const BYD_HOST = 'my433447.businessbydesign.cloud.sap';
const BYD_PATH = '/sap/bc/srt/scs/sap/queryproductionlotisiin';
const BYD_ACTION = 'http://sap.com/xi/A1S/Global/QueryProductionLotISIIn/FindByElementsRequest';
const BYD_AUTH = 'Basic ' + Buffer.from('_DEV:Welcome123').toString('base64');

function buildEnvelope(count, dateFrom, dateTo) {
  const maxHits = count || 100;

  // Date filter using SelectionByProductionLotCreationDateTime (per WSDL)
  let dateFilter = '';
  if (dateFrom && dateTo) {
    dateFilter = `
        <SelectionByProductionLotCreationDateTime>
          <InclusionExclusionCode>I</InclusionExclusionCode>
          <IntervalBoundaryTypeCode>3</IntervalBoundaryTypeCode>
          <LowerBoundaryDate>${dateFrom}T00:00:00Z</LowerBoundaryDate>
          <UpperBoundaryDate>${dateTo}T23:59:59Z</UpperBoundaryDate>
        </SelectionByProductionLotCreationDateTime>`;
  } else if (dateFrom) {
    dateFilter = `
        <SelectionByProductionLotCreationDateTime>
          <InclusionExclusionCode>I</InclusionExclusionCode>
          <IntervalBoundaryTypeCode>1</IntervalBoundaryTypeCode>
          <LowerBoundaryDate>${dateFrom}T00:00:00Z</LowerBoundaryDate>
        </SelectionByProductionLotCreationDateTime>`;
  } else if (dateTo) {
    dateFilter = `
        <SelectionByProductionLotCreationDateTime>
          <InclusionExclusionCode>I</InclusionExclusionCode>
          <IntervalBoundaryTypeCode>2</IntervalBoundaryTypeCode>
          <UpperBoundaryDate>${dateTo}T23:59:59Z</UpperBoundaryDate>
        </SelectionByProductionLotCreationDateTime>`;
  }

  // Per WSDL: SelectionByProductionLotStatusCode uses LogisticsLifeCycleStatusCode
  // SAP ByD Production Lot status codes:
  //   1 = In Preparation  ✅ include
  //   2 = Released        ✅ include
  //   3 = In Process      ✅ include
  //   4 = Completed       ❌ exclude
  //   5 = Cancelled       ❌ exclude
  //   6 = Closed          ❌ exclude
  // Strategy: INCLUDE codes 1 through 3 using IntervalBoundaryTypeCode=3 (between)
  const statusFilter = `
        <SelectionByProductionLotStatusCode>
          <InclusionExclusionCode>I</InclusionExclusionCode>
          <IntervalBoundaryTypeCode>3</IntervalBoundaryTypeCode>
          <LowerBoundaryLifeCycleStatusCode>1</LowerBoundaryLifeCycleStatusCode>
          <UpperBoundaryLifeCycleStatusCode>3</UpperBoundaryLifeCycleStatusCode>
        </SelectionByProductionLotStatusCode>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:glob="http://sap.com/xi/SAPGlobal20/Global">
  <soapenv:Header/>
  <soapenv:Body>
    <glob:ProductionLotByElementsQuery_sync>
      <ProductionLotSelectionByElements>${statusFilter}${dateFilter}
      </ProductionLotSelectionByElements>
      <ProcessingConditions>
        <QueryHitsMaximumNumberValue>${maxHits}</QueryHitsMaximumNumberValue>
        <QueryHitsUnlimitedIndicator>false</QueryHitsUnlimitedIndicator>
      </ProcessingConditions>
    </glob:ProductionLotByElementsQuery_sync>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Production Task Manager Proxy', byd: BYD_HOST }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/sync') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let count = 100, dateFrom = '', dateTo = '';
    try {
      const parsed = JSON.parse(body);
      count    = parseInt(parsed.count)    || 100;
      dateFrom = parsed.dateFrom || '';
      dateTo   = parsed.dateTo   || '';
    } catch(e) {}

    const envelope = buildEnvelope(count, dateFrom, dateTo);
    console.log(`[${new Date().toISOString()}] → SAP | count:${count} from:${dateFrom||'any'} to:${dateTo||'any'}`);

    const options = {
      hostname: BYD_HOST,
      port: 443,
      path: BYD_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': BYD_ACTION,
        'Authorization': BYD_AUTH,
        'Content-Length': Buffer.byteLength(envelope),
      },
    };

    const bydReq = https.request(options, (bydRes) => {
      let data = '';
      bydRes.on('data', chunk => data += chunk);
      bydRes.on('end', () => {
        console.log(`[${new Date().toISOString()}] ← HTTP ${bydRes.statusCode} (${data.length} bytes)`);
        res.writeHead(bydRes.statusCode, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(data);
      });
    });

    bydReq.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] ✗`, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    bydReq.write(envelope);
    bydReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`\n  SAP ByD Proxy running on port ${PORT}\n`);
});
