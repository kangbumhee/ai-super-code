from flask import Flask, render_template, request, jsonify

app = Flask(__name__)


@app.route("/")
def index():
    """메인 계산기 페이지 렌더링"""
    return render_template("index.html")


@app.route("/calculate", methods=["POST"])
def calculate():
    """계산 API