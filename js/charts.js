// ============================================================
// Charts 模块 — Chart.js 图表渲染
// ============================================================

let pieChartInst = null;
let barChartInst = null;

function renderPieChart(cats, catCounts) {
  const canvas = document.getElementById('pieChart');
  if (!canvas) return;

  if (pieChartInst) pieChartInst.destroy();

  pieChartInst = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: cats,
      datasets: [{
        data: catCounts,
        backgroundColor: ['#C49A78', '#7DB87B', '#7BABE8'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 13 }, padding: 16 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} 种` } }
      }
    }
  });
}

function renderBarChart(cats, catVals) {
  const canvas = document.getElementById('barChart');
  if (!canvas) return;

  if (barChartInst) barChartInst.destroy();

  barChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: cats,
      datasets: [{
        label: '库存价值 (元)',
        data: catVals,
        backgroundColor: ['#C49A78CC', '#7DB87BCC', '#7BABE8CC'],
        borderColor: ['#A0785A', '#5B8C5A', '#4A7FBB'],
        borderWidth: 2,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => '¥' + (v >= 10000 ? (v / 10000).toFixed(1) + '万' : v.toLocaleString())
          }
        }
      }
    }
  });
}
