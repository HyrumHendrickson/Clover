/** Starting programs for the Programming tab, one per language. Each runs as is, with no input. */
export const STARTERS = {
  python: `def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


print([fib(i) for i in range(15)])
`,
  rust: `fn main() {
    let squares: Vec<u32> = (1..=10).map(|n| n * n).collect();
    println!("{:?}", squares);
}
`,
  c: `#include <stdio.h>

int main(void) {
    for (int i = 1; i <= 5; i++) {
        printf("%d squared is %d\\n", i, i * i);
    }
    return 0;
}
`,
  cpp: `#include <iostream>
#include <vector>

int main() {
    std::vector<int> squares;
    for (int i = 1; i <= 5; ++i) squares.push_back(i * i);
    for (int s : squares) std::cout << s << '\\n';
    return 0;
}
`,
  java: `public class Main {
    public static void main(String[] args) {
        for (int i = 1; i <= 5; i++) {
            System.out.println(i + " squared is " + (i * i));
        }
    }
}
`,
};
