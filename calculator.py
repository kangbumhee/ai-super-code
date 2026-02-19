def calculator():
    print("=" * 30)
    print("   간단한 계산기")
    print("=" * 30)
    print("사용 가능한 연산: +, -, *, /")
    print("종료하려면 'q'를 입력하세요.\n")

    while True:
        num1 = input("첫 번째 숫자: ")
        if num1.lower() == 'q':
            print("계산기를 종료합니다. 안녕히 가세요!")
            break

        op = input("연산자 (+, -, *, /): ")
        if op.lower() == 'q':
            print("계산기를 종료합니다. 안녕히 가세요!")
            break

        num2 = input("두 번째 숫자: ")
        if num2.lower() == 'q':
            print("계산기를 종료합니다. 안녕히 가세요!")
            break

        try:
            n1 = float(num1)
            n2 = float(num2)

            if op == '+':
                result = n1 + n2
            elif op == '-':
                result = n1 - n2
            elif op == '*':
                result = n1 * n2
            elif op == '/':
                if n2 == 0:
                    print("오류: 0으로 나눌 수 없습니다.\n")
                    continue
                result = n1 / n2
            else:
                print("오류: 지원하지 않는 연산자입니다.\n")
                continue

            # 정수면 정수로, 소수면 소수로 출력
            if result == int(result):
                print(f"결과: {n1} {op} {n2} = {int(result)}\n")
            else:
                print(f"결과: {n1} {op} {n2} = {result:.6g}\n")

        except ValueError:
            print("오류: 올바른 숫자를 입력해 주세요.\n")


if __name__ == "__main__":
    calculator()
